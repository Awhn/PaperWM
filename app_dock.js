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
        this._log(`PI-AppDock enabled setting changed to: ${this._piAppDockEnabled}`);
        if (this._piAppDockEnabled) {
            this._showDockActor();
        } else {
            this._hideDockActor();
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

    _showDockActor() {
        if (this.actor) {
            this.actor.show();
        } else {
            // If enable() was skipped due to initial setting, we need to create actor now.
            // This logic assumes 'enable()' will now proceed if _piAppDockEnabled is true.
            this._log("Attempting to enable and show dock actor as it was not previously created.");
            this.enable(); // This will call _applyPositionSetting and show the actor.
        }
        this._log("Dock actor shown.");
    }

    _hideDockActor() {
        if (this.actor) {
            this.actor.hide();
        }
        this._log("Dock actor hidden.");
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
        // Called when the extension is enabled
        this._log("Enabling AppDock");

        if (!this._piAppDockEnabled) {
            this._log("AppDock is disabled by setting, skipping actor creation.");
            // Ensure actor is hidden if it somehow exists or was shown before setting changed
            if (this.actor) this.actor.hide();
            return;
        }

        if (this.actor) {
             // Actor already exists, likely from _showDockActor calling enable()
             this._applyPositionSetting(); // Ensure position is correct
             this.actor.show();
             this._updateDock();
             this._log("AppDock re-enabled or already enabled and configured.");
             return;
        }

        // Create the main actor for the dock
        this.actor = new St.BoxLayout({
            name: 'piAppDock',
            // style_class will be set by _applyPositionSetting
            vertical: false,
        });

        this.iconContainer = new St.BoxLayout({
            name: 'piAppDockIconContainer',
            style_class: 'pi-app-dock-icon-container',
            vertical: false, // Will be adjusted by _applyPositionSetting
        });
        this.actor.add_child(this.iconContainer);

        this._applyPositionSetting(); // Set initial position and style_class
        Main.layoutManager.addChrome(this.actor, { trackFullscreen: true });


        // TODO: Connect to signals from tiling.js for window changes
        // Example: this._connectSignal(Tiling.spaces, 'window-added', this._updateDock.bind(this));
        // Example: this._connectSignal(Tiling.spaces, 'window-removed', this._updateDock.bind(this));
        // Example: this._connectSignal(Tiling.spaces, 'layout-changed', this._updateDock.bind(this)); // Or a more specific signal

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        const extensionStylesheet = Me.path + '/app_dock.css';
        try {
            let file = Gio.file_new_for_path(extensionStylesheet);
            if (file.query_exists(null)) {
                this._themeContext.get_theme().load_stylesheet(file);
                this._log('app_dock.css loaded.');
            } else {
                this._logError('app_dock.css not found.');
            }
        } catch (e) {
            this._logError(`Error loading app_dock.css: ${e.message}`);
        }

        // Persistent connection for workspace switches
        if (Tiling && Tiling.spaces) {
            this._connectSignal(Tiling.spaces, 'switch-workspace', this._onWorkspaceSwitched.bind(this));
        } else {
            this._logError('Tiling.spaces not available to connect switch-workspace signal.');
        }

        // Connect to signals for the initially active workspace
        if (Tiling && Tiling.spaces) {
            let currentActiveSpace = Tiling.spaces.getActiveSpace();
            if (currentActiveSpace) {
                this._connectToWorkspaceSignals(currentActiveSpace);
            } else {
                this._logError('No active space found on enable to connect workspace signals.');
            }
        }

        this._updateDock(); // Initial population of the dock

        if (this._piAppDockEnabled) {
            this.actor.show();
        } else {
            this.actor.hide(); // Should not happen if check at start of enable() is effective
        }
        this._log("AppDock enabled process complete.");
    }

    disable() {
        // Called when the extension is disabled
        this._log("Disabling AppDock");
        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
            this.actor = null;
        }
        this.iconContainer = null;

        if (this._themeContext) {
            const extensionStylesheet = Me.path + '/app_dock.css';
            try {
                let file = Gio.file_new_for_path(extensionStylesheet);
                if (file.query_exists(null)) {
                    this._themeContext.get_theme().unload_stylesheet(file);
                    this._log('app_dock.css unloaded.');
                }
            } catch (e) {
                this._logError(`Error unloading app_dock.css: ${e.message}`);
            }
            this._themeContext = null;
        }

        this._disconnectCurrentWorkspaceSignals(); // Explicitly disconnect current workspace signals
        this._disconnectAllSignals(); // Disconnect all other signals (like the Tiling.spaces switch-workspace itself)
        this._log("AppDock disabled");
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

        // If actor is already in chrome, remove it before changing properties that might affect layout
        if (this.actor.get_parent() === Main.layoutManager.uiGroup) { // Heuristic check if added to chrome
             Main.layoutManager.removeChrome(this.actor);
        }

        let vertical = (this._currentPosition === 'left' || this._currentPosition === 'right');
        this.actor.vertical = vertical;
        this.iconContainer.vertical = vertical;

        // Basic style changes; more complex positioning might need different panel boxes or strut properties
        if (this._currentPosition === 'bottom') {
            this.actor.style_class = 'pi-app-dock pi-app-dock-bottom';
        } else if (this._currentPosition === 'left') {
            this.actor.style_class = 'pi-app-dock pi-app-dock-left';
        } else if (this._currentPosition === 'right') {
            this.actor.style_class = 'pi-app-dock pi-app-dock-right';
        }

        // Add back to chrome if it was removed, or if this is the first time.
        // Avoid duplicate adding if it wasn't removed (e.g. initial setup path)
        if (this.actor.get_parent() !== Main.layoutManager.uiGroup) {
            Main.layoutManager.addChrome(this.actor, { trackFullscreen: true /*, affectsStruts: true, etc. */ });
        }
        this._log(`Dock position applied: ${this._currentPosition}, vertical: ${vertical}`);
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
