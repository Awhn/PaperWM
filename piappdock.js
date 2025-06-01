import St from 'gi://St';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell'; // For AppSystem and App
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib'; // For GLib.idle_add
import { spaces as TilingSpaces } from './tiling.js'; // Assuming Tiling.spaces is exported as 'spaces'
// import { Settings } from './settings.js'; // This path might need adjustment, if direct settings access is needed here

export class PIAppDock {
    constructor(tilingSpaces, settings) {
        this._tilingSpaces = tilingSpaces;
        this._settings = settings;

        this._dockActor = null;
        this._icons = new Map(); // Map of appId to St.Button

        this._visible = false;

        // Connections to Tiling.Space signals
        this._windowAddedSignalId = 0;
        this._windowRemovedSignalId = 0;
        this._windowSwappedSignalId = 0;
        this._layoutChangedSignalId = 0; // For layout changes on the space
        this._settingsChangedSignalIds = []; // To store IDs of settings signals
    }

    enable() {
        // console.log('PIAppDock enabling...');

        this._dockActor = new St.BoxLayout({
            name: 'piAppDock',
            style_class: 'pi-app-dock', // Will be updated by settings
            reactive: true,
            track_hover: true,
            vertical: false, // Will be updated by settings
        });

        Main.layoutManager.uiGroup.add_child(this._dockActor);
        // Initial position and visibility will be set by _onSettingsChanged

        this._populateInitialIcons();
        this._connectToSpaceSignals();
        this._connectToSettingsSignals(); // Connect to GSettings
        this._onSettingsChanged(); // Apply initial settings

        // this._visible is managed by _onSettingsChanged based on piappdock-enable
        // console.log('PIAppDock enabled finished.');
    }

    disable() {
        // console.log('PIAppDock disabling...');
        if (this._dockActor) {
            Main.uiGroup.remove_child(this._dockActor);
            this._dockActor.destroy();
            this._dockActor = null;
        }

        this._disconnectFromSpaceSignals();
        this._disconnectFromSettingsSignals(); // Disconnect from GSettings
        this._icons.forEach(iconActor => iconActor.destroy());
        this._icons.clear();

        this._visible = false;
        // console.log('PIAppDock disabled.');
    }

    _populateInitialIcons() {
        // TODO:
        // const activeSpace = this._tilingSpaces?.activeSpace;
        // if (!activeSpace) return;
        const activeSpace = this._tilingSpaces?.activeSpace;
        if (!activeSpace) {
            // console.log('PIAppDock: No active space to populate icons from.');
            return;
        }

        // activeSpace.getWindows() returns an array of columns, and each column is an array of Meta.Windows
        const windowsInColumns = activeSpace.getWindows();
        const windows = windowsInColumns.flat(); // Flatten to a single list of Meta.Window

        windows.forEach(win => this._addIconForWindow(win));
        this._updateIconOrder();
        // console.log('PIAppDock: Populated initial icons.');
    }

    _addIconForWindow(metaWindow) {
        if (!metaWindow) return;

        const app = Shell.AppSystem.get_default().lookup_app_for_window(metaWindow);
        if (!app || !app.get_app_info()) {
            // console.log('PIAppDock: Not a window with an app info.');
            return;
        }

        const appId = app.get_id();
        if (!appId) {
            // console.log('PIAppDock: Could not get app ID.');
            return;
        }

        if (this._icons.has(appId)) {
            // console.log(`PIAppDock: Icon for ${appId} already exists.`);
            return;
        }

        const icon = new St.Icon({
            gicon: app.get_app_info().get_icon(),
            style_class: 'pi-app-dock-icon',
            // icon_size will be set by CSS or settings later
        });

        const button = new St.Button({
            child: icon,
            style_class: 'pi-app-dock-button',
        });
        button.connect('clicked', () => this._onIconClicked(app));

        this._dockActor.add_child(button);
        this._icons.set(appId, button);
        // console.log(`PIAppDock: Added icon for ${appId}`);
        this._applySettingsDrivenPositioning();
    }

    _removeIconForApp(appId) {
        if (this._icons.has(appId)) {
            const button = this._icons.get(appId);
            this._dockActor.remove_child(button);
            button.destroy();
            this._icons.delete(appId);
            // console.log(`PIAppDock: Removed icon for ${appId}`);
            this._applySettingsDrivenPositioning();
        } else {
            // console.log(`PIAppDock: No icon found for ${appId} to remove.`);
        }
    }

    _updateIconOrder() {
        const activeSpace = this._tilingSpaces?.activeSpace;
        if (!activeSpace || !this._dockActor) return;

        const windowsInColumns = activeSpace.getWindows();
        const windows = windowsInColumns.flat();
        const appOrder = [];
        const seenApps = new Set();

        for (const win of windows) {
            const app = Shell.AppSystem.get_default().lookup_app_for_window(win);
            if (app && app.get_id()) {
                const appId = app.get_id();
                if (!seenApps.has(appId)) {
                    appOrder.push(appId);
                    seenApps.add(appId);
                }
            }
        }

        this._dockActor.remove_all_children();

        appOrder.forEach(appId => {
            const button = this._icons.get(appId);
            if (button) {
                this._dockActor.add_child(button);
            }
        });
        // console.log('PIAppDock: Updated icon order.');
        this._applyIconSizeFromSettings(); // Ensure new icons get the right size
        this._applySettingsDrivenPositioning();
    }

    _onWindowAdded(space, metaWindow) {
        // console.log('PIAppDock: Window added signal received.');
        this._addIconForWindow(metaWindow);
        this._updateIconOrder();
    }

    _onWindowRemoved(space, metaWindow) {
        // console.log('PIAppDock: Window removed signal received.');
        const app = Shell.AppSystem.get_default().lookup_app_for_window(metaWindow);
        if (app && app.get_id()) {
            const appId = app.get_id();
            const activeSpace = this._tilingSpaces?.activeSpace;
            if (activeSpace) {
                const windowsForApp = activeSpace.getWindows().flat().filter(
                    win => Shell.AppSystem.get_default().lookup_app_for_window(win)?.get_id() === appId
                );
                if (windowsForApp.length === 0) {
                    this._removeIconForApp(appId);
                }
            } else { // If no active space, assume we should remove if app is gone
                 this._removeIconForApp(appId);
            }
        }
        this._updateIconOrder();
    }

    _onWindowSwapped(space, win1, win2, direction) {
        // console.log('PIAppDock: Window swapped signal received.');
        this._updateIconOrder();
    }

    _onLayoutChanged(space) {
        // console.log('PIAppDock: Layout changed signal received.');
        this._updateIconOrder();
    }


    _onIconClicked(app) {
        // console.log(`PIAppDock: Icon clicked for ${app.get_id()}`);
        const activeSpace = this._tilingSpaces?.activeSpace;
        if (!activeSpace) return;

        const windows = activeSpace.getWindows().flat();
        const appWindow = windows.find(win =>
            Shell.AppSystem.get_default().lookup_app_for_window(win)?.get_id() === app.get_id()
        );

        if (appWindow) {
            activeSpace.workspace.activate_with_focus(appWindow, global.get_current_time());
            // console.log(`PIAppDock: Focusing app ${app.get_name()}`);
        } else {
            // console.log(`PIAppDock: No window found for app ${app.get_name()} in active space.`);
        }
    }

    _connectToSpaceSignals() {
        if (!this._tilingSpaces) {
            // console.log('PIAppDock: TilingSpaces not available to connect signals.');
            return;
        }
        // Assuming Tiling.spaces itself emits signals for active space changes, or we connect to a specific space.
        // For now, let's assume activeSpace is somewhat stable or we'd need to listen to activeSpace changes.
        const activeSpace = this._tilingSpaces.activeSpace;
        if (!activeSpace) {
            // console.log('PIAppDock: No active space to connect signals to.');
            return;
        }

        if (activeSpace.connect) { // Check if activeSpace is a GObject that can connect
            this._windowAddedSignalId = activeSpace.connect('window-added', this._onWindowAdded.bind(this));
            this._windowRemovedSignalId = activeSpace.connect('window-removed', this._onWindowRemoved.bind(this));
            this._windowSwappedSignalId = activeSpace.connect('swapped', this._onWindowSwapped.bind(this));
            // PaperWM's Space class emits a 'layout' signal
            this._layoutChangedSignalId = activeSpace.connect('layout', this._onLayoutChanged.bind(this));
            // console.log('PIAppDock: Connected to active space signals.');
        } else {
            // console.error('PIAppDock: activeSpace does not have a connect method.');
        }
    }

    _disconnectFromSpaceSignals() {
        const activeSpace = this._tilingSpaces?.activeSpace; // Or store the connected space instance
        if (!activeSpace || !activeSpace.disconnect) return;

        if (this._windowAddedSignalId) activeSpace.disconnect(this._windowAddedSignalId);
        if (this._windowRemovedSignalId) activeSpace.disconnect(this._windowRemovedSignalId);
        if (this._windowSwappedSignalId) activeSpace.disconnect(this._windowSwappedSignalId);
        if (this._layoutChangedSignalId) activeSpace.disconnect(this._layoutChangedSignalId);

        this._windowAddedSignalId = 0;
        this._windowRemovedSignalId = 0;
        this._windowSwappedSignalId = 0;
        this._layoutChangedSignalId = 0;
        // console.log('PIAppDock: Disconnected from space signals.');
    }

    // Placeholder for settings changed listeners
    _connectToSettingsSignals() {
        if (!this._settings) {
            // console.log('PIAppDock: Settings object not available for connecting signals.');
            return;
        }
        const settingsToWatch = ['piappdock-enable', 'piappdock-position', 'piappdock-icon-size'];
        settingsToWatch.forEach(settingName => {
            const signalId = this._settings.connect(`changed::${settingName}`, () => this._onSettingsChanged());
            this._settingsChangedSignalIds.push(signalId);
        });
        // console.log('PIAppDock: Connected to settings signals.');
    }

    _disconnectFromSettingsSignals() {
        if (!this._settings) return;
        this._settingsChangedSignalIds.forEach(signalId => {
            if (signalId > 0) { // Valid signal ID
                this._settings.disconnect(signalId);
            }
        });
        this._settingsChangedSignalIds = [];
        // console.log('PIAppDock: Disconnected from settings signals.');
    }

    _onSettingsChanged() {
        if (!this._settings || !this._dockActor) {
            // console.log('PIAppDock: Settings or dock actor not ready for settings change.');
            return;
        }

        const enabled = this._settings.get_boolean('piappdock-enable');
        // console.log(`PIAppDock: Setting 'piappdock-enable': ${enabled}`);

        if (enabled) {
            if (!this._visible) {
                // This implies the dock was previously disabled and is now being enabled.
                // Re-populate and show.
                this._populateInitialIcons(); // Repopulate if it was cleared or became stale
                 this._dockActor.show();
                this._visible = true;
                // console.log('PIAppDock: Dock shown due to settings change.');
            }

            const position = this._settings.get_string('piappdock-position');
            const iconSizeSetting = this._settings.get_string('piappdock-icon-size');
            // console.log(`PIAppDock: Setting 'piappdock-position': ${positionSetting}`);
            // console.log(`PIAppDock: Setting 'piappdock-icon-size': ${iconSizeSetting}`);

            // Apply Icon Size
            this._applyIconSizeFromSettings(iconSizeSetting);

            // Apply Position & Orientation
            this._applyDockPositionAndOrientation(positionSetting);

        } else { // Dock is disabled via settings
            if (this._visible) {
                this._dockActor.hide();
                this._visible = false;
                // console.log('PIAppDock: Dock hidden due to settings change (disabled).');
            }
        }
    }

    _applyIconSizeFromSettings(sizeSettingOverride = null) {
        if (!this._settings || !this._dockActor) return;

        const iconSizeSetting = sizeSettingOverride || this._settings.get_string('piappdock-icon-size');
        let newIconSize = 32; // default to medium
        if (iconSizeSetting === 'small') newIconSize = 24;
        else if (iconSizeSetting === 'large') newIconSize = 48;

        this._dockActor.get_children().forEach(button => {
            if (button.child && button.child instanceof St.Icon) {
                button.child.set_icon_size(newIconSize);
            }
        });

        this._dockActor.remove_style_class_name('pi-app-dock-small-icons');
        this._dockActor.remove_style_class_name('pi-app-dock-medium-icons');
        this._dockActor.remove_style_class_name('pi-app-dock-large-icons');
        this._dockActor.add_style_class_name('pi-app-dock-' + iconSizeSetting + '-icons');
        // console.log(`PIAppDock: Applied icon size: ${iconSizeSetting} (${newIconSize}px)`);

        // After changing icon sizes, the dock's overall size might change, so re-apply positioning.
        this._applySettingsDrivenPositioning();
    }

    _applyDockPositionAndOrientation(positionSettingOverride = null) {
        if (!this._settings || !this._dockActor) return;

        const positionSetting = positionSettingOverride || this._settings.get_string('piappdock-position');

        this._dockActor.remove_style_class_name('pi-app-dock-bottom');
        this._dockActor.remove_style_class_name('pi-app-dock-left');
        this._dockActor.remove_style_class_name('pi-app-dock-right');

        switch (positionSetting) {
            case 'left':
                this._dockActor.vertical = true;
                this._dockActor.add_style_class_name('pi-app-dock-left');
                break;
            case 'right':
                this._dockActor.vertical = true;
                this._dockActor.add_style_class_name('pi-app-dock-right');
                break;
            case 'bottom':
            default:
                this._dockActor.vertical = false;
                this._dockActor.add_style_class_name('pi-app-dock-bottom');
                break;
        }
        // console.log(`PIAppDock: Applied orientation for position: ${positionSetting}, Vertical: ${this._dockActor.vertical}`);
        this._applySettingsDrivenPositioning();
    }

    _applySettingsDrivenPositioning() {
        if (!this._settings || !this._dockActor || !this._visible) return;

        // Defer to ensure actor dimensions are up-to-date
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!this._dockActor || !this._settings || !this._visible) return GLib.SOURCE_REMOVE; // Check actor still exists

            const primaryMonitor = Main.layoutManager.primaryMonitor;
            const positionSetting = this._settings.get_string('piappdock-position');
            let newX, newY;

            const dockWidth = this._dockActor.get_width();
            const dockHeight = this._dockActor.get_height();

            switch (positionSetting) {
                case 'left':
                    newX = 10; // 10px offset from edge
                    newY = Math.floor((primaryMonitor.height - dockHeight) / 2);
                    break;
                case 'right':
                    newX = primaryMonitor.width - dockWidth - 10; // 10px offset from edge
                    newY = Math.floor((primaryMonitor.height - dockHeight) / 2);
                    break;
                case 'bottom':
                default:
                    newX = Math.floor((primaryMonitor.width - dockWidth) / 2);
                    newY = primaryMonitor.height - dockHeight - 10; // 10px offset from edge
                    break;
            }
            this._dockActor.set_position(Math.floor(newX), Math.floor(newY));
            // console.log(`PIAppDock: Final position applied via idle_add. X: ${newX}, Y: ${newY} for position '${positionSetting}'`);
            return GLib.SOURCE_REMOVE;
        });
    }
}
