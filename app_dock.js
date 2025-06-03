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

        try {
            if (Tiling && Tiling.spaces) {
                this._log('Tiling module and spaces object seem accessible.');
                let activeSpace = Tiling.spaces.getActiveSpace();
                if (activeSpace) {
                    this._log('Active space obtained.');
                    let windows = activeSpace.getWindows();
                    this._log(`Found ${windows.length} windows in active space.`);
                } else {
                    this._logError('Could not get active space.');
                }

                // Test connecting to switch-workspace signal
                this._connectSignal(Tiling.spaces, 'switch-workspace', () => {
                    this._log('Successfully received switch-workspace signal from Tiling.spaces');
                    // In a real scenario, we would update the dock here
                });
                this._log('Attempted to connect to Tiling.spaces switch-workspace signal.');

            } else {
                this._logError('Tiling module or spaces object is not accessible.');
            }
        } catch (e) {
            this._logError(`Error accessing Tiling module or its properties: ${e.message}`);
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

        this._disconnectAllSignals();
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
        // TODO: Implement actual logic to get ordered windows from Tiling.js
        // This will likely involve accessing Tiling.spaces.getActiveSpace().getWindows()
        // or a similar mechanism, and then processing that list.
        // The order should match PaperWM's window order.
        this._log("Fetching ordered windows from Tiling (placeholder)");
        return []; // Placeholder
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
