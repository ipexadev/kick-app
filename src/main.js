const { app, BrowserWindow, Tray, Menu, dialog, net, session, ipcMain } = require(`electron`);
const { autoUpdater } = require(`electron-updater`);
const DiscordRPC = require(`discord-rpc`);
const path = require(`path`);
require('dotenv').config();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
    return;
}

let mainWindow, updater;
let tray;
let oldTitle;
const clientId = `1112901248421732462`;
DiscordRPC.register(clientId);
const rpc = new DiscordRPC.Client({ transport: 'ipc' });

let updateAvailable = false;
let updateAccepted = false;

async function startApp() {
    // Disable auto updater in development mode
    if (process.env.DEV_MODE === "on") {
        createWindow();
        createTray();
        return;
    }
    /*
    autoUpdater.setFeedURL({
        provider: "github",
        owner: `ipexadev`,
        repo: `kick-app`
    });*/
    autoUpdater.setFeedURL({
        provider: "generic",
        url: 'https://cdn.ipexa.dev/kick-app/stable/updates'
    });

    try {

        // If an update is available, show the updater window and download the update
        const updater = new BrowserWindow({
            width: 500,
            height: 500,
            show: true,
            frame: false,
            webPreferences: {
                nodeIntegration: true
            },
            fullscreenable: true,
            title: "Kick App | Updater",
            icon: path.join(__dirname, "../assets/icons/app_icon.png")
        });

        // Check for updates
        const updateCheckResult = await autoUpdater.checkForUpdates();
        const { updateInfo } = updateCheckResult;
        const isUpdateAvailable = updateInfo.version !== app.getVersion();

        // If no update is available, create the main window and tray
        if (!isUpdateAvailable) {
            updater.loadFile(path.join(__dirname, "../assets/updater/html/no_updates.html"));

            // Close the updater window and create the main window and tray after 4 seconds
            setTimeout(() => {
                updater.close();
                createWindow();
                createTray();
            }, 4000);
            return;
        }

        updater.setMenu(null);
        await updater.loadFile(path.join(__dirname, "../assets/updater/html/update_searching.html"));

        autoUpdater.on("update-available", () => {
            setTimeout(() => {
                updater.loadFile(path.join(__dirname, "../assets/updater/html/update_available.html"));
            }, 3000);

            setTimeout(() => {
                autoUpdater.downloadUpdate();
            }, 10000);
        });

        autoUpdater.on("download-progress", (progressObj) => {
            updater.show(); // Show updater window during download
            updater.loadFile(
                path.join(__dirname, "../assets/updater/html/update_downloading.html")
            );
            updater.webContents.send("update-progress", progressObj.percent);
        });

        autoUpdater.on("update-downloaded", () => {
            updater.loadFile(path.join(__dirname, "../assets/updater/html/update_downloaded.html"));

            // Quit and install the update after 10 seconds
            setTimeout(() => {
                autoUpdater.quitAndInstall(true, true);
            }, 10000);
        });

        autoUpdater.on("update-not-available", () => {
            updater.loadFile(path.join(__dirname, "../assets/updater/html/no_updates.html"));

            // Close the updater window and create the main window and tray after 4 seconds
            setTimeout(() => {
                updater.close();
                createWindow();
                createTray();
            }, 4000);
        });

        autoUpdater.on("error", () => {
            updater.loadFile(path.join(__dirname, "../assets/updater/html/update_error.html"));

            // Close the updater window and create the main window and tray after 4 seconds
            setTimeout(() => {
                updater.close();
                createWindow();
                createTray();
            }, 4000);
        });
    } catch (err) {
        console.error(err);

        // If an error occurs, create the main window and tray
        createWindow();
        createTray();
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        darkTheme: true,
        height: 600,
        show: true,
        webPreferences: {
            nodeIntegration: true,
        },
        fullscreenable: true,
        title: `Kick App`,
        closable: true,
        autoHideMenuBar: true,
        icon: path.join(__dirname, `../assets/icons/app_icon.png`),
    });

    mainWindow.loadURL(`https://www.kick.com`);

    // Emitted when the window is closed
    mainWindow.on(`close`, (event) => {
        if (app.isQuitting) {
            mainWindow = null;
        } else {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    const interceptedUsernames = new Set();

    mainWindow.on(`page-title-updated`, (event, title) => {
        const defaultSession = session.defaultSession;

        interceptedUsernames.clear();

        // Intercept the HTTP Requests
        if(title.split(` | `).length > 1) {
            defaultSession.webRequest.onBeforeRequest((details, callback) => {
                // Check if its a GET Request and URL starts with 'https://kick.com/api/v2/channels/'
                if (details.method === `GET` && details.url.startsWith(`https://kick.com/api/v2/channels/`)) {
                    // Grab the username using regex '/channel/username'
                    const usernameRegex = /\/channels\/([^/]+)/;
                    const match = details.url.match(usernameRegex);
                    // If matches then continue
                    if (match && match[1] && !/^\d+$/.test(match[1])) {
                        const username = match[1];
                        // Just add it to a Set so it only prints once, due to multiple requests being made that starts with that username
                        if (!interceptedUsernames.has(username)) {
                            interceptedUsernames.add(username);

                            //if(title !== `${username} | Kick`) return;

                            const request = net.request(`https://kick.com/api/v2/channels/${username}`);
                            request.on(`response`, (response) => {
                                let data = ``;

                                response.on(`data`, (chunk) => {
                                    data += chunk;
                                });

                                // Setup RPC
                                response.on(`end`, () => {
                                    let json;
                                    try {
                                        json = JSON.parse(data);
                                    } catch (error) {
                                        return;
                                    }

                                    if (json === null) return;
                                    if (json.message !== null && typeof json.message === `string` && json.message.includes("not found in kick.com`s database")) return;
                                    if (json.livestream === null) return;

                                    const startTimestamp = new Date();

                                    rpc.setActivity({
                                        details: json.livestream.session_title,
                                        state: json.livestream.categories[0].name,
                                        startTimestamp,
                                        largeImageKey: json.livestream.thumbnail.url,
                                        largeImageText: json.user.username,
                                        smallImageKey: 'app_icon',
                                        smallImageText: `Kick App ${autoUpdater.currentVersion}`,
                                        instance: false,
                                        buttons: [
                                            { label: `Watch Here`, url: `https://kick.com/${username}` },
                                            { label: `Download Kick App`, url: `https://github.com/ipexadev/kick-app/releases/latest` }
                                        ],
                                    });
                                });
                            });

                            request.on(`error`, (error) => {
                                console.error(`Error:`, error);
                            });

                            request.end();
                        }
                    }
                }
                callback({});
            });
        } else {
            rpc.clearActivity();
        }
    });
}

function createTray() {
    tray = new Tray(path.join(__dirname, `../assets/icons/app_icon.png`));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: `Show`,
            click: () => {
                mainWindow.show();
            },
        },
        {
            label: `Exit`,
            click: () => {
                app.isQuitting = true;
                app.quit();
            },
        },
    ]);

    tray.on(`click`, () => {
        mainWindow.show();
    });

    tray.setContextMenu(contextMenu);
}

app.on(`ready`, () => {
    //createWindow();
    // createTray();
    //checkForUpdates(); // Call the update checker function
    startApp();
});

app.on(`activate`, () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        //createWindow();
        startApp();
    }
});

rpc.login({ clientId }).catch(console.error);