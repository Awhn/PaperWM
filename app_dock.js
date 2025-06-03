const { St, Clutter, Gio, Shell, Meta } = imports.gi;
const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Tiling = Me.imports.tiling; // Assuming tiling.js will provide window info
const Settings = Me.imports.settings;

var AppDock = class {
    constructor() {
        this.actor = null; // The main actor for the dock
        this.iconContainer = null; // Actor to hold the icons
        this._signals = new Map(); // To store signal connections
        this._currentWorkspaceSignalIds = new Map(); // For workspace-specific signals
        this._actorAddedToChrome = false;

        this._settings = Settings.actualGioSettings; // Use the exported Gio.Settings instance
        this._piAppDockEnabled = this._settings.get_boolean(Settings.PI_APP_DOCK_ENABLED_KEY);
        this._currentPosition = this._settings.get_string(Settings.PI_APP_DOCK_POSITION_KEY);
        this._currentIconSizeKey = this._settings.get_string(Settings.PI_APP_DOCK_ICON_SIZE_KEY);
        // Use the exported ICON_SIZE_MAP from settings.js
        this._currentIconPixelSize = Settings.ICON_SIZE_MAP[this._currentIconSizeKey] || Settings.ICON_SIZE_MAP.medium;


        this._connectSignal(this._settings, `changed::${Settings.PI_APP_DOCK_ENABLED_KEY}`, this._onEnableChanged.bind(this));
        this._connectSignal(this._settings, `changed::${Settings.PI_APP_DOCK_POSITION_KEY}`, this._onPositionChanged.bind(this));
        this._connectSignal(this._settings, `changed::${Settings.PI_APP_DOCK_ICON_SIZE_KEY}`, this._onIconSizeChanged.bind(this));
    }

    init() {
        // Called when the extension is initialized
        // TODO: Perform any one-time setup
    }

    _disconnectCurrentWorkspaceSignals() {
        this._log(`Disconnecting ${this._currentWorkspaceSignalIds.size} signals from previously active workspace.`);
        this._currentWorkspaceSignalIds.forEach((source, id) => {
            try {
                source.disconnect(id);
                // Remove from the main _signals map as well, since _connectSignal added it there.
                if (this._signals.has(id)) {
                    this._signals.delete(id);
                }
            } catch (e) {
                this._logError(`Error disconnecting workspace signal id ${id}: ${e.message}`);
            }
        });
        this._currentWorkspaceSignalIds.clear();
    }

    _connectToWorkspaceSignals(activeSpace) {
        if (!activeSpace) {
            this._logError("Cannot connect to workspace signals: activeSpace is null");
            return;
        }
        this._log(`Connecting to signals for workspace: ${activeSpace.workspace.index()}`);

        let w_added_id = this._connectSignal(activeSpace, 'window-added', this._updateDock.bind(this));
        let w_removed_id = this._connectSignal(activeSpace, 'window-removed', this._updateDock.bind(this));
        let layout_id = this._connectSignal(activeSpace, 'layout', this._updateDock.bind(this));

        if(w_added_id) this._currentWorkspaceSignalIds.set(w_added_id, activeSpace);
        if(w_removed_id) this._currentWorkspaceSignalIds.set(w_removed_id, activeSpace);
        if(layout_id) this._currentWorkspaceSignalIds.set(layout_id, activeSpace);

        this._log(`Connected to window-added, window-removed, layout signals for workspace ${activeSpace.workspace.index()}. Tracked ${this._currentWorkspaceSignalIds.size} signals.`);
    }

    _onWorkspaceSwitched() {
        this._log("Workspace switched event received.");
        this._disconnectCurrentWorkspaceSignals(); // Disconnect from old workspace

        if (Tiling && Tiling.spaces) {
            let activeSpace = Tiling.spaces.getActiveSpace();
            if (activeSpace) {
                this._connectToWorkspaceSignals(activeSpace);
            }
        }
        this._updateDock(); // Update dock for new workspace
    }

    _onEnableChanged() {
        this._piAppDockEnabled = this._settings.get_boolean(Settings.PI_APP_DOCK_ENABLED_KEY);
        this._log(`PI-AppDock enabled GSetting changed to: ${this._piAppDockEnabled}`);
        if (this.actor) { // Only act if actor has been initialized by enable()
            if (this._piAppDockEnabled) {
                this._showDockActorInternal();
            } else {
                this._hideDockActorInternal();
            }
        } else {
            this._log("Dock actor not yet initialized, enable() will handle visibility based on this new setting.");
        }
    }

    _onPositionChanged() {
        this._currentPosition = this._settings.get_string(Settings.PI_APP_DOCK_POSITION_KEY);
        this._log(`PI-AppDock position setting changed to: ${this._currentPosition}`);
        this._applyPositionSetting();
        this._updateDock(); // Redraw icons as orientation/size might effectively change
    }

    _onIconSizeChanged() {
        this._currentIconSizeKey = this._settings.get_string(Settings.PI_APP_DOCK_ICON_SIZE_KEY);
        this._currentIconPixelSize = Settings.ICON_SIZE_MAP[this._currentIconSizeKey] || Settings.ICON_SIZE_MAP.medium;
        this._log(`PI-AppDock icon size setting changed to: ${this._currentIconSizeKey} (${this._currentIconPixelSize}px)`);
        this._updateDock(); // Re-render icons with new size
    }

    _showDockActorInternal() {
        if (!this.actor) {
            this._logError("Cannot show dock: actor does not exist. This should not happen if enable() ran.");
            return;
        }
        this._log("Showing dock actor internally.");

        if (!this._actorAddedToChrome) {
            Main.layoutManager.addChrome(this.actor, { trackFullscreen: true });
            this._actorAddedToChrome = true;
            this._log("Actor added to chrome.");
        }

        this._applyPositionSetting();
        this.actor.show();

        this._disconnectCurrentWorkspaceSignals();
        if (Tiling && Tiling.spaces) {
            let currentActiveSpace = Tiling.spaces.getActiveSpace();
            if (currentActiveSpace) {
                this._connectToWorkspaceSignals(currentActiveSpace);
            }
        }
        this._updateDock();
    }

    _hideDockActorInternal() {
        if (!this.actor) {
            // this._log("Cannot hide dock: actor does not exist. Nothing to do."); // Less alarming log
            return;
        }
        this._log("Hiding dock actor internally.");
        this.actor.hide();
        if (this._actorAddedToChrome) {
            Main.layoutManager.removeChrome(this.actor);
            this._actorAddedToChrome = false;
            this._log("Actor removed from chrome.");
        }
        this._disconnectCurrentWorkspaceSignals();
    }

    // Re-introducing _workspaceSignalIds and _disconnectWorkspaceSignals as per the detailed plan
    // if we want to correctly disconnect from old workspace on switch.
    // Constructor change:
    // this._workspaceSignalIds = new Map();

    // _disconnectWorkspaceSignals() {
    //     this._workspaceSignalIds.forEach((source, id) => {
    //         try {
    //             source.disconnect(id);
    //         } catch (e) {
    //             this._logError(`Error disconnecting workspace signal id ${id}: ${e.message}`);
    //         }
    //     });
    //     this._workspaceSignalIds.clear();
    //     this._log("Disconnected all workspace-specific signals");
    // }
    // And _connectToWorkspaceSignals would use this._workspaceSignalIds.set(...)
    // And _onWorkspaceSwitched would call _disconnectWorkspaceSignals() first.
    // And disable() would also call _disconnectWorkspaceSignals().

    // For THIS iteration, sticking to the "simpler" path means _onWorkspaceSwitched just updates the dock.
    // And _connectToWorkspaceSignals is called once in enable() for the *initial* active space.
    // This means dock icons ONLY update for the initial workspace's events unless switch-workspace also updates.

    // Let's refine _onWorkspaceSwitched to be more robust with the current _connectSignal
    // It should disconnect signals connected by _connectToWorkspaceSignals for the *previous* space.
    // This is where a tagging or separate management in _connectSignal would be useful.
    // Since _connectSignal doesn't support that, we will have to assume _disconnectAllSignals
    // is the only cleanup point, or _updateDock is smart enough.

    // Per the prompt's structure, let's re-add the separate workspace signal management.
    // This means the constructor needs this._workspaceSignalIds = new Map();
    // And _connectToWorkspaceSignals needs to use it.
    // And _disconnectWorkspaceSignals needs to be defined.
    // And _onWorkspaceSwitched calls _disconnectWorkspaceSignals.
    // And disable calls _disconnectWorkspaceSignals.

    // The alternative in the prompt was:
    // _connectToWorkspaceSignals using this._connectSignal. If so, _workspaceSignalIds and _disconnectWorkspaceSignals are not needed.
    // Let's re-verify the chosen path: "I will choose the alternative for _connectToWorkspaceSignals that uses the existing this._connectSignal helper."
    // This means _onWorkspaceSwitched does NOT call a specific disconnect. Relies on _updateDock getting current space.
    // And `enable` connects to initial workspace.

    enable() {
        this._log("Main enable() called for AppDock.");

        if (!this.actor) {
            this._log("Actor not yet created. Initializing actor instance.");
            this.actor = new St.BoxLayout({
                name: 'piAppDock',
                vertical: false,
            });
            this.iconContainer = new St.BoxLayout({
                name: 'piAppDockIconContainer',
                style_class: 'pi-app-dock-icon-container',
                vertical: false,
            });
            this.actor.add_child(this.iconContainer);
            // DO NOT add to chrome here initially. _actorAddedToChrome remains false.
        } else {
            this._log("Actor instance already exists.");
        }

        // Load CSS (idempotent check)
        if (!this._themeContext) {
            this._themeContext = St.ThemeContext.get_for_stage(global.stage);
            const extensionStylesheet = Me.path + '/app_dock.css';
            try {
                let file = Gio.file_new_for_path(extensionStylesheet);
                if (file.query_exists(null)) {
                    this._themeContext.get_theme().load_stylesheet(file);
                    this._log('app_dock.css loaded.');
                } else { this._logError('app_dock.css not found.'); }
            } catch (e) { this._logError(`Error loading app_dock.css: ${e.message}`); }
        }

        // Connect non-workspace specific signals (settings are in constructor)
        // Ensure Tiling.spaces signal is connected ONCE.
        // Use a flag or check if already in this._signals to prevent duplicate connection if enable is called multiple times by shell.
        if (!this._signals.has(`Tiling.spaces-switch-workspace`)) { // Example of a unique ID for this connection
             const sigId = this._connectSignal(Tiling.spaces, 'switch-workspace', this._onWorkspaceSwitched.bind(this));
             if (sigId) this._signals.set(`Tiling.spaces-switch-workspace`, Tiling.spaces); // Track it with a unique key
        }

        // Check current GSetting and show/hide accordingly
        this._piAppDockEnabled = this._settings.get_boolean(Settings.PI_APP_DOCK_ENABLED_KEY);
        if (this._piAppDockEnabled) {
            this._log("Dock is enabled by GSetting. Showing via _showDockActorInternal...");
            this._showDockActorInternal();
        } else {
            this._log("Dock is disabled by GSetting. Ensuring it's hidden via _hideDockActorInternal...");
            this._hideDockActorInternal(); // Ensures it's hidden and removed from chrome if it was somehow added
        }
        this._log("AppDock enable() process complete.");
    }

    disable() {
        this._log("Disabling AppDock");
        this._hideDockActorInternal(); // Ensures actor is hidden and removed from chrome

        this._disconnectCurrentWorkspaceSignals(); // Called by _hideDockActorInternal, but good to be explicit if flow changes
        this._disconnectAllSignals();

        if (this.actor) {
            try {
                this.actor.destroy();
                this._log("Actor destroyed.");
            } catch (e) {
                this._logError(`Error destroying actor: ${e.message}`);
            }
        }
        this.actor = null;
        this.iconContainer = null;
        this._actorAddedToChrome = false; // Reset flag

        if (this._themeContext) {
            const extensionStylesheet = Me.path + '/app_dock.css';
            try {
                let file = Gio.file_new_for_path(extensionStylesheet);
                if (file.query_exists(null)) {
                    this._themeContext.get_theme().unload_stylesheet(file);
                    this._log('app_dock.css unloaded.');
                }
            } catch (e) { this._logError(`Error unloading app_dock.css: ${e.message}`); }
            this._themeContext = null;
        }
        this._log("AppDock disabled and cleaned up.");
    }

    _updateDock() {
        // Main logic to refresh the dock
        this._log("Updating dock");
        if (!this.iconContainer) return;

        this.iconContainer.destroy_all_children();

        let windows = this._getOrderedWindows();

        windows.forEach(appInfo => {
            // const app = Shell.AppSystem.get_default().lookup_app_for_window(appInfo.window);
            // For now, assuming appInfo directly IS a Meta.Window from _getOrderedWindows()
            const metaWindow = appInfo; // Assuming appInfo is a Meta.Window
            const app = Shell.AppSystem.get_default().lookup_app_for_window(metaWindow);

            if (!app) {
                this._logError(`No app found for window: ${metaWindow.get_title()}`);
                return; // Use 'continue' if in a forEach loop, or handle appropriately
            }

            const icon = app.create_icon_texture(this._getIconSize());
            if (!icon) {
                this._logError(`Could not create icon for app: ${app.get_id()}`);
                return;
            }
            icon.style_class = 'pi-app-dock-icon'; // Ensure style class is applied

            let button = new St.Button({ child: icon, style_class: 'pi-app-dock-button' });
            button.connect('clicked', () => {
                this._log(`Icon clicked: ${app.get_name()}, window: ${metaWindow.get_title()}`);
                Main.activateWindow(metaWindow);
            });
            this.iconContainer.add_child(button);
        });
    }

    _getOrderedWindows() {
        if (Tiling && Tiling.spaces) {
            let activeSpace = Tiling.spaces.getActiveSpace();
            if (activeSpace) {
                this._log(`Fetching windows for workspace: ${activeSpace.workspace.index()}`);
                let windows = activeSpace.getWindows(); // getWindows() in tiling.js returns a flat array
                return windows || [];
            } else {
                this._logError('Could not get active space to fetch windows.');
                return []; // Return empty array if no active space
            }
        } else {
            this._logError('Tiling module or spaces object not accessible for fetching windows.');
            return []; // Return empty array if Tiling/spaces not accessible
        }
        // Ensure a value is always returned, even if it's caught by an implicit undefined before.
        // However, the above logic covers all paths to return [].
    }

    _getPlaceholderWindows() {
        // Placeholder function to simulate fetching window data
        // Replace this with actual data from Tiling.js
        return [
            { name: "App 1", iconName: "org.gnome.Nautilus-symbolic", window: null }, // window would be Meta.Window
            { name: "App 2", iconName: "org.gnome.Terminal-symbolic", window: null },
            { name: "App 3", iconName: "firefox-symbolic", window: null },
        ];
    }

    _getIconSize() {
        return this._currentIconPixelSize;
    }

    _applyPositionSetting() {
        if (!this.actor) return;
        // Main.layoutManager.removeChrome(this.actor); // REMOVE THIS LINE

        let vertical = (this._currentPosition === 'left' || this._currentPosition === 'right');
        this.actor.vertical = vertical;
        this.iconContainer.vertical = vertical;

        if (this._currentPosition === 'bottom') {
            this.actor.style_class = 'pi-app-dock pi-app-dock-bottom';
        } else if (this._currentPosition === 'left') {
            this.actor.style_class = 'pi-app-dock pi-app-dock-left';
        } else if (this._currentPosition === 'right') {
            this.actor.style_class = 'pi-app-dock pi-app-dock-right';
        }
        // Main.layoutManager.addChrome(this.actor, { trackFullscreen: true }); // REMOVE THIS LINE
        this._log(`Dock position properties applied: ${this._currentPosition}, vertical: ${vertical}`);
    }

    _connectSignal(source, eventName, callback) {
        if (!source || !source.connect) {
            this._logError(`Cannot connect to signal on invalid source for event: ${eventName}`);
            return;
        }
        const id = source.connect(eventName, callback);
        this._signals.set(id, source);
        this._log(`Connected signal for ${eventName} with id ${id}`);
    }

    _disconnectAllSignals() {
        this._signals.forEach((source, id) => {
            try {
                source.disconnect(id);
            } catch (e) {
                this._logError(`Error disconnecting signal id ${id}: ${e.message}`);
            }
        });
        this._signals.clear();
        this._log("All signals disconnected");
    }

    _log(message) {
        log(`[PI-AppDock] ${message}`);
    }

    _logError(message) {
        logError(`[PI-AppDock] ERROR: ${message}`);
    }
};
