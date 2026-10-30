import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Constants
const MAX_DISPLAY_NUMBER = 999;
const MIN_DISPLAY_NUMBER = 0;
const TRAY_TEXT_FONT_PX = 16;
const TRAY_TEXT_HEIGHT_PX = 22;
// Drawn at 2x and tagged as 2x, so the size in points is exactly the constants above.
const TRAY_TEXT_SCALE = 2;
const LINUX_TRAY_SIZE_PX = 32;
const TOOLTIP_ROW_HEIGHT = 28;
const TOOLTIP_PADDING = 12;

const LOW = 70;  // Hypoglycemia threshold (mg/dL)
const HIGH = 240; // Hyperglycemia threshold (mg/dL)

// Interfaces
interface RGBAColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface TrayReading {
  name: string;
  mgdl: number;
  targetLow?: number;
  targetHigh?: number;
  /** LibreLinkUp TrendArrow, 1 (falling fast) to 5 (rising fast). */
  trend?: number;
  /** No data from the sensor for too long; shown as "--" and left out of min/max. */
  stale?: boolean;
}

interface TrayManagerState {
  tray: Tray | null;
  currentNumber: number;
  previousNumber: number;
  displayValue: string;
  mainWindow: BrowserWindow | null;
  currentUnit: string;
  targetLow: number;
  targetHigh: number;
  isCreated: boolean;
  trendArrow: number;
  trayTitle: string;
  readings: { name: string; value: number; targetLow?: number; targetHigh?: number; trend?: number; stale?: boolean }[];
}

const TREND_TEXT: Record<number, string> = { 1: '↓', 2: '↘', 3: '→', 4: '↗', 5: '↑' };

const TREND_ARROW_MAP: Record<number, string> = {
  1: `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.14645 2.14645C7.34171 1.95118 7.65829 1.95118 7.85355 2.14645L11.8536 6.14645C12.0488 6.34171 12.0488 6.65829 11.8536 6.85355C11.6583 7.04882 11.3417 7.04882 11.1464 6.85355L8 3.70711L8 12.5C8 12.7761 7.77614 13 7.5 13C7.22386 13 7 12.7761 7 12.5L7 3.70711L3.85355 6.85355C3.65829 7.04882 3.34171 7.04882 3.14645 6.85355C2.95118 6.65829 2.95118 6.34171 3.14645 6.14645L7.14645 2.14645Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>`,
  2: `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.3536 3.64644C11.5488 3.8417 11.5488 4.15828 11.3536 4.35354L4.70711 11L9 11C9.27614 11 9.5 11.2239 9.5 11.5C9.5 11.7761 9.27614 12 9 12L3.5 12C3.36739 12 3.24021 11.9473 3.14645 11.8536C3.05268 11.7598 3 11.6326 3 11.5L3 5.99999C3 5.72385 3.22386 5.49999 3.5 5.49999C3.77614 5.49999 4 5.72385 4 5.99999V10.2929L10.6464 3.64643C10.8417 3.45117 11.1583 3.45117 11.3536 3.64644Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>`,
  3: `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.14645 3.14645C8.34171 2.95118 8.65829 2.95118 8.85355 3.14645L12.8536 7.14645C13.0488 7.34171 13.0488 7.65829 12.8536 7.85355L8.85355 11.8536C8.65829 12.0488 8.34171 12.0488 8.14645 11.8536C7.95118 11.6583 7.95118 11.3417 8.14645 11.1464L11.2929 8H2.5C2.22386 8 2 7.77614 2 7.5C2 7.22386 2.22386 7 2.5 7H11.2929L8.14645 3.85355C7.95118 3.65829 7.95118 3.34171 8.14645 3.14645Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>`,
  4: `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.64645 3.64644C3.45118 3.8417 3.45118 4.15828 3.64645 4.35354L10.2929 11L6 11C5.72386 11 5.5 11.2239 5.5 11.5C5.5 11.7761 5.72386 12 6 12L11.5 12C11.6326 12 11.7598 11.9473 11.8536 11.8536C11.9473 11.7598 12 11.6326 12 11.5L12 5.99999C12 5.72385 11.7761 5.49999 11.5 5.49999C11.2239 5.49999 11 5.72385 11 5.99999V10.2929L4.35355 3.64643C4.15829 3.45117 3.84171 3.45117 3.64645 3.64644Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>`,
  5: `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.5 2C7.77614 2 8 2.22386 8 2.5L8 11.2929L11.1464 8.14645C11.3417 7.95118 11.6583 7.95118 11.8536 8.14645C12.0488 8.34171 12.0488 8.65829 11.8536 8.85355L7.85355 12.8536C7.75979 12.9473 7.63261 13 7.5 13C7.36739 13 7.24021 12.9473 7.14645 12.8536L3.14645 8.85355C2.95118 8.65829 2.95118 8.34171 3.14645 8.14645C3.34171 7.95118 3.65829 7.95118 3.85355 8.14645L7 11.2929L7 2.5C7 2.22386 7.22386 2 7.5 2Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>`,
};

const DEFAULT_ARROW_SVG = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.14645 3.14645C8.34171 2.95118 8.65829 2.95118 8.85355 3.14645L12.8536 7.14645C13.0488 7.34171 13.0488 7.65829 12.8536 7.85355L8.85355 11.8536C8.65829 12.0488 8.34171 12.0488 8.14645 11.8536C7.95118 11.6583 7.95118 11.3417 8.14645 11.1464L11.2929 8H2.5C2.22386 8 2 7.77614 2 7.5C2 7.22386 2.22386 7 2.5 7H11.2929L8.14645 3.85355C7.95118 3.65829 7.95118 3.34171 8.14645 3.14645Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>`;

// Tray Manager Class
class TrayManager {
  private state: TrayManagerState = {
    tray: null,
    currentNumber: 0,
    previousNumber: 0,
    displayValue: '0',
    mainWindow: null,
    currentUnit: '',
    targetLow: 70,
    targetHigh: 180,
    isCreated: false,
    trendArrow: 3,
    readings: [],
    trayTitle: '0',
  };

  private tooltipWindow: BrowserWindow | null = null;
  /** macOS: the readings drawn as a template image, so the text size is ours to choose. */
  private textImage: Electron.NativeImage | null = null;
  /** What the macOS image draws: one coloured pill per value in the title. */
  private traySegments: { text: string; color: string }[] = [];
  private textRenderId = 0;
  private isShowingTooltip: boolean = false;

  public updateTargets(targetLow: number, targetHigh: number): void {
    this.state.targetLow = targetLow;
    this.state.targetHigh = targetHigh;

    if (this.state.tray && this.state.currentNumber !== 0) {
      this.updateExistingTray();
    }
  }

  // Format number for display: 33.345 → 33.35, 3.3 → 3.3, 3.0 → 3
  private formatDisplayNumber(number: number): string {
    if (number >= MAX_DISPLAY_NUMBER) {
      return MAX_DISPLAY_NUMBER.toString();
    }

    if (number <= MIN_DISPLAY_NUMBER) {
      return MIN_DISPLAY_NUMBER.toString();
    }

    // Check if it's a whole number
    if (Number.isInteger(number)) {
      return number.toString();
    }

    // Format to 2 decimal places, but remove trailing .00 and trailing zero after decimal
    const formatted = number.toFixed(2);

    // Remove trailing zeros after decimal point
    if (formatted.endsWith('.00')) {
      return formatted.slice(0, -3);
    } else if (formatted.endsWith('0')) {
      return formatted.slice(0, -1);
    }

    return formatted;
  }

  // Main public methods
  public createTray(window: BrowserWindow): void {
    if (this.state.isCreated && this.state.tray) {
      this.state.mainWindow = window;
      return;
    }

    this.state.mainWindow = window;

    if (!this.state.isCreated) {
      this.createStandardTray();
    }
    this.state.isCreated = true;
  }

  public destroyTray(): void {
    this.state.tray?.destroy();
    this.state.tray = null;
    this.state.isCreated = false;

    if (this.tooltipWindow) {
      this.tooltipWindow.destroy();
      this.tooltipWindow = null;
    }
  }

  /** Title shows the lowest and highest reading (one value for one patient); the menu lists every patient's latest. */
  public updateReadings(readings: TrayReading[], unit: string): void {
    if (readings.length === 0) {
      this.clearReadings();
      return;
    }
    const convert = (mgdl: number) => (unit === 'mmol/L' ? Math.round((mgdl / 18) * 10) / 10 : Math.round(mgdl));
    // Stale patients are left out of min/max; if none are fresh the title is "--".
    const fresh = readings.filter((r) => !r.stale);
    const ranged = fresh.length > 0 ? fresh : readings;
    const highest = ranged.reduce((a, b) => (b.mgdl > a.mgdl ? b : a));
    this.state.readings = readings.map((r) => ({
      name: r.name,
      value: this.clampNumber(convert(r.mgdl)),
      targetLow: r.targetLow,
      targetHigh: r.targetHigh,
      trend: r.trend,
      stale: r.stale,
    }));
    const lowest = ranged.reduce((a, b) => (b.mgdl < a.mgdl ? b : a));
    const fmt = (r: TrayReading) =>
      `${this.formatDisplayNumber(this.clampNumber(convert(r.mgdl)))}${this.trendText(r.trend)}`;
    this.state.trayTitle =
      fresh.length === 0 ? '--' : fresh.length > 1 ? `${fmt(lowest)}–${fmt(highest)}` : fmt(highest);
    this.state.currentUnit = unit;
    const pill = (r: TrayReading) => ({
      text: fmt(r),
      color: this.rgbToCss(this.getBackgroundColorForGlucoseLevel(
        this.clampNumber(convert(r.mgdl)), r.targetLow, r.targetHigh,
      )),
    });
    const noSignal = { text: '--', color: 'rgb(107, 114, 128)' };
    this.traySegments =
      fresh.length === 0 ? [noSignal]
        : fresh.length > 1 ? [pill(lowest), pill(highest)] : [pill(highest)];
    // A patient without signal must stay visible next to the ones that still have values.
    if (fresh.length > 0 && fresh.length < readings.length) this.traySegments.push(noSignal);
    this.updateTrayNumber(convert(highest.mgdl), unit, highest.targetLow, highest.targetHigh);
  }

  /** No patients left: drop the title and the readings from the menu and popup. */
  private clearReadings(): void {
    this.state.readings = [];
    this.state.trayTitle = '';
    this.traySegments = [];
    if (!this.state.tray || !this.state.isCreated) return;
    this.textImage = null;
    this.textRenderId++;
    this.state.tray.setTitle('');
    if (process.platform === 'linux') this.state.tray.setToolTip('');
    this.state.tray.setImage(this.getTrayImage());
    this.updateTooltipContent();
    this.updateTrayContextMenu();
  }

  public updateTrayNumber(
    newNumber: number,
    unit: string,
    targetLow?: number,
    targetHigh?: number,
    trendArrow?: number,
  ): void {
    this.state.previousNumber = this.state.currentNumber;

    const clampedNumber = this.clampNumber(newNumber);
    this.state.currentNumber = clampedNumber;
    this.state.displayValue = this.formatDisplayNumber(clampedNumber);
    this.state.currentUnit = unit;

    if (targetLow !== undefined && targetHigh !== undefined) {
      this.state.targetLow = targetLow;
      this.state.targetHigh = targetHigh;
    }

    if (trendArrow !== undefined) {
      this.state.trendArrow = trendArrow;
    }

    if (this.state.tray && this.state.isCreated) {
      this.updateExistingTray();
    }
  }

  public hasTray(): boolean {
    return this.state.isCreated && this.state.tray !== null;
  }

  public getCreationState(): boolean {
    return this.state.isCreated;
  }

  private clampNumber(number: number): number {
    return Math.max(MIN_DISPLAY_NUMBER, Math.min(MAX_DISPLAY_NUMBER, number));
  }

  private createStandardTray(): void {
    try {
      const trayIcon = this.createIconFromFile();
      this.createTrayInstance(trayIcon);
    } catch (error) {
      console.error('PNG icon failed, trying fallback icon:', error);
      const trayIcon = this.createSimpleIcon();
      this.createTrayInstance(trayIcon);
    }
  }

  /** macOS and Linux draw the readings as an image; Linux trays (KDE's StatusNotifier) ignore setTitle. */
  private rendersTextImage(): boolean {
    return process.platform === 'darwin' || process.platform === 'linux';
  }

  /** On macOS the readings are shown as text alone; the icon is only used when there is no text. */
  private getTrayImage(): Electron.NativeImage {
    return this.rendersTextImage() && this.state.trayTitle && this.textImage
      ? this.textImage
      : this.createIconFromFile();
  }

  /** Draws the readings as text in a hidden window. macOS: black on one pill per value, coloured by glucose level. Linux: black on a pill coloured by glucose level, readable on any panel theme. */
  private async renderTextImage(text: string): Promise<Electron.NativeImage> {
    if (process.platform === 'linux') return this.renderSquareImage(text);
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      width: 400,
      height: TRAY_TEXT_HEIGHT_PX * TRAY_TEXT_SCALE,
      webPreferences: { offscreen: true, contextIsolation: true },
    });
    try {
      const segments = this.traySegments.length > 0 ? this.traySegments : [{ text, color: 'rgb(107, 114, 128)' }];
      const pills = segments
        .map((s) => `<span style="background:${s.color};padding:0 ${5 * TRAY_TEXT_SCALE}px;border-radius:${4 * TRAY_TEXT_SCALE}px">${this.escapeHtml(s.text)}</span>`)
        .join('');
      const html = `<body style="margin:0;background:transparent;overflow:hidden"><div id="t" style="display:inline-flex;gap:${3 * TRAY_TEXT_SCALE}px;`
        + `white-space:nowrap;font:600 ${14 * TRAY_TEXT_SCALE}px/${TRAY_TEXT_HEIGHT_PX * TRAY_TEXT_SCALE}px -apple-system,BlinkMacSystemFont,sans-serif;`
        + `font-variant-numeric:tabular-nums;color:#000">${pills}</div></body>`;
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const width = Math.ceil(await win.webContents.executeJavaScript('document.getElementById("t").getBoundingClientRect().width'));
      const height = TRAY_TEXT_HEIGHT_PX * TRAY_TEXT_SCALE;
      win.setContentSize(width, height);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const captured = await win.webContents.capturePage({ x: 0, y: 0, width, height });
      return nativeImage.createFromBuffer(captured.toPNG(), { scaleFactor: TRAY_TEXT_SCALE });
    } finally {
      win.destroy();
    }
  }

  /**
   * Linux: KDE shrinks any wide icon to fit a square box, so draw a square. Black bold text on a pill coloured by
   * glucose level (readable on any panel theme); lines are stacked and the font shrinks only as far as needed to fit.
   * One patient: the value over its arrow; several: lowest over highest.
   */
  private async renderSquareImage(text: string): Promise<Electron.NativeImage> {
    const size = LINUX_TRAY_SIZE_PX * TRAY_TEXT_SCALE;
    const arrows = Object.values(TREND_TEXT);
    const last = text.slice(-1);
    const lines = text.includes('–') ? text.split('–') : arrows.includes(last) ? [text.slice(0, -1), last] : [text];
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      width: size,
      height: size,
      webPreferences: { offscreen: true, contextIsolation: true },
    });
    try {
      const color = this.rgbToCss(this.getBackgroundColorForGlucoseLevel(this.state.currentNumber));
      const lineHeight = size / lines.length;
      const html = `<body style="margin:0;background:transparent;overflow:hidden"><div id="b" style="width:${size}px;height:${size}px;`
        + `box-sizing:border-box;background:${color};border-radius:${4 * TRAY_TEXT_SCALE}px;display:flex;flex-direction:column;`
        + `align-items:center;justify-content:center;color:#000;font:700 ${lineHeight}px/${lineHeight}px sans-serif;`
        + `font-variant-numeric:tabular-nums;white-space:nowrap">${lines.map((l) => `<div class="l">${this.escapeHtml(l)}</div>`).join('')}</div></body>`;
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await win.webContents.executeJavaScript(
        `(() => { const b = document.getElementById("b"); const w = Math.max(...[...b.querySelectorAll(".l")].map((e) => e.scrollWidth));`
        + ` if (w > ${size}) b.style.fontSize = (${lineHeight} * ${size} / w) + "px"; })()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const captured = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
      return nativeImage.createFromBuffer(captured.toPNG(), { scaleFactor: TRAY_TEXT_SCALE });
    } finally {
      win.destroy();
    }
  }

  private updateTextImage(): void {
    const id = ++this.textRenderId;
    this.renderTextImage(this.state.trayTitle)
      .then((image) => {
        if (id !== this.textRenderId || !this.state.tray) return;
        this.textImage = image;
        this.state.tray.setImage(image);
      })
      .catch((error) => console.error('Failed to render tray text:', error));
  }

  private createIconFromFile(): Electron.NativeImage {
    try {
      // Try multiple possible asset directories for both dev and production
      const possibleAssetDirs = [
        path.join(app.getAppPath(), 'assets'),
        path.join(process.resourcesPath, 'assets'),
        path.join(__dirname, 'assets'),
        path.join(__dirname, '..', 'assets'),
        path.join(__dirname, '..', '..', 'assets'),
        path.join(process.cwd(), 'assets'),
      ];

      for (const assetsDir of possibleAssetDirs) {
        if (fs.existsSync(assetsDir)) {
          console.log('Checking assets directory:', assetsDir);

          // Platform-specific icon loading
          let iconPath: string | null = null;

          switch (process.platform) {
            case 'darwin': // macOS
              // Use 16x16 icon as the standard for macOS tray
              const macIconPath16 = path.join(assetsDir, 'tray-logo-16.png');
              const macIconPath16Retina = path.join(assetsDir, 'tray-logo-16@2x.png');

              if (fs.existsSync(macIconPath16)) {
                iconPath = macIconPath16;
                console.log('Found macOS 16x16 icon:', macIconPath16);

                // Check for @2x version for Retina displays
                if (fs.existsSync(macIconPath16Retina)) {
                  console.log('Found macOS 16x16@2x icon for Retina:', macIconPath16Retina);
                }
              }
              break;

            default:
              // Use original tray-logo.png for Windows and Linux
              const originalIconPath = path.join(assetsDir, 'tray-logo.png');
              if (fs.existsSync(originalIconPath)) {
                iconPath = originalIconPath;
                console.log('Found original icon:', originalIconPath);
              }
              break;
          }

          // If platform-specific icon found, use it
          if (iconPath) {
            const icon = nativeImage.createFromPath(iconPath);

            // For macOS, try to add @2x version for Retina displays
            if (process.platform === 'darwin' && iconPath.includes('tray-logo-16.png')) {
              const retinaPath = iconPath.replace('tray-logo-16.png', 'tray-logo-16@2x.png');
              if (fs.existsSync(retinaPath)) {
                console.log('Adding @2x version for Retina display:', retinaPath);
                // Electron will automatically use the @2x version on Retina displays
                // when both files exist with the same base name
              }
            }

            // Don't use template mode - it makes colored icons appear black
            // Template mode only works with monochromatic (black/white) icons
            // icon.setTemplateImage(true);

            return icon;
          }
        }
      }

      console.error('No PNG icon found in any of the expected locations');
      console.error('App path:', app.getAppPath());
      console.error('Resources path:', process.resourcesPath);
      console.error('Current working directory:', process.cwd());
      console.error('__dirname:', __dirname);
      throw new Error('No PNG icon found');
    } catch (error) {
      console.error('Failed to load icon from file:', error);
      throw error;
    }
  }

  private createSimpleIcon(): Electron.NativeImage {
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);

    // Fill with transparent background
    buffer.fill(0);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = 6;

    // Draw orange circle
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= radius) {
          const index = (y * size + x) * 4;
          // Orange color #F30 (255, 51, 0) in BGRA format
          buffer[index] = 0;      // Blue
          buffer[index + 1] = 51; // Green
          buffer[index + 2] = 255; // Red
          buffer[index + 3] = 255; // Alpha
        }
      }
    }

    return nativeImage.createFromBuffer(buffer, {
      width: size,
      height: size
    });
  }

  private createTrayInstance(icon: Electron.NativeImage): void {
    try {
      this.state.tray = new Tray(icon);
      this.setupTrayEventListeners();
      this.updateTrayContextMenu();
      this.state.isCreated = true;
    } catch (error) {
      console.error('Failed to create tray instance:', error);
      this.state.isCreated = false;
    }
  }

  private setupTrayEventListeners(): void {
    if (!this.state.tray) return;

    this.createTooltipWindow();

    this.state.tray.on('click', () => {
      if (this.state.mainWindow) {
        if (this.state.mainWindow.isVisible()) {
          this.state.mainWindow.hide();
        } else {
          this.state.mainWindow.show();
          this.state.mainWindow.focus();
        }
        this.updateTrayContextMenu();
      }
      this.hideTooltip();
    });

    // Show custom tooltip on mouse enter
    this.state.tray.on('mouse-enter', () => {
      if (this.tooltipWindow) {
        this.updateTooltipContent();
        this.showTooltip();
      }
    });

    // Hide custom tooltip on mouse leave
    this.state.tray.on('mouse-leave', () => {
      this.hideTooltip();
    });

    (this.state.tray as NodeJS.EventEmitter).on('destroyed', () => {
      this.state.tray = null;
      this.state.isCreated = false;
      if (this.tooltipWindow) {
        this.tooltipWindow.destroy();
        this.tooltipWindow = null;
      }
    });
  }

  private createTooltipWindow(): void {
    if (this.tooltipWindow) return;

    this.tooltipWindow = new BrowserWindow({
      width: 260,
      height: TOOLTIP_PADDING + TOOLTIP_ROW_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Load the tooltip HTML content
    this.tooltipWindow.loadURL(`data:text/html;charset=utf-8,${this.getTooltipHTML()}`);

    this.tooltipWindow.on('blur', () => {
      this.hideTooltip();
    });

    this.tooltipWindow.on('close', () => {
      this.tooltipWindow = null;
    });
  }

  private trendText(trend?: number): string {
    return TREND_TEXT[trend ?? 3] ?? '';
  }

  private escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  private getTooltipHTML(): string {
    const { currentUnit, trendArrow, readings } = this.state;
    const trendSvg = TREND_ARROW_MAP[trendArrow] || DEFAULT_ARROW_SVG;

    const rows = readings.length
      ? readings
          .map((r) => {
            const color = r.stale
              ? 'rgb(107, 114, 128)'
              : this.rgbToCss(this.getBackgroundColorForGlucoseLevel(r.value, r.targetLow, r.targetHigh));
            const text = r.stale
              ? '--'
              : `${this.formatDisplayNumber(r.value)} ${this.escapeHtml(currentUnit)} ${this.trendText(r.trend)}`;
            return `<div class="row"><span class="name">${this.escapeHtml(r.name)}</span>` +
              `<span class="value" style="background:${color}">${text}</span></div>`;
          })
          .join('')
      : `<div class="row"><span class="name">No readings</span></div>`;

    return encodeURIComponent(`
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #1f2937;
        color: #ffffff;
        padding: 6px 8px;
        box-sizing: border-box;
        user-select: none;
        -webkit-user-select: none;
        overflow: hidden;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        height: ${TOOLTIP_ROW_HEIGHT}px;
        font-size: 15px;
      }
      .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .value {
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 6px;
        white-space: nowrap;
        color: #ffffff;
      }
    </style>
  </head>
  <body>${rows}</body>
  </html>`);
  }

  private showTooltip(): void {
    if (!this.state.tray || !this.tooltipWindow) return;

    try {
      const trayBounds = this.state.tray.getBounds();
      const windowBounds = this.tooltipWindow.getBounds();

      const x = Math.round(trayBounds.x + (trayBounds.width - windowBounds.width) / 2);
      const y = Math.round(trayBounds.y - windowBounds.height - 5);

      this.tooltipWindow.setPosition(x, y);
      this.tooltipWindow.show();
      this.isShowingTooltip = true;
    } catch (error) {
      console.error('Error showing tooltip:', error);
    }
  }

  private hideTooltip(): void {
    if (this.tooltipWindow) {
      this.tooltipWindow.hide();
      this.isShowingTooltip = false;
    }
  }

  private updateTooltipContent(): void {
    if (this.tooltipWindow && !this.tooltipWindow.isDestroyed()) {
      const rows = Math.max(1, this.state.readings.length);
      this.tooltipWindow.setSize(260, TOOLTIP_PADDING + rows * TOOLTIP_ROW_HEIGHT);
      this.tooltipWindow.loadURL(`data:text/html;charset=utf-8,${this.getTooltipHTML()}`);
    }
  }

  private updateExistingTray(): void {
    if (!this.state.tray || !this.state.isCreated) return;

    try {
      this.state.tray.setImage(this.getTrayImage());
      if (this.rendersTextImage()) {
        // setTitle can't change the font size (macOS) or is ignored (Linux), so the text is an image.
        this.state.tray.setTitle('');
        this.updateTextImage();
      } else {
        this.state.tray.setTitle(this.state.trayTitle);
      }
      if (process.platform === 'linux') this.state.tray.setToolTip(this.getToolTipText());
      this.updateTooltipContent();
      this.updateTrayContextMenu();
      this.notifyRenderer();
    } catch (error) {
      console.error('Error updating tray icon:', error);
      try {
        const newIcon = this.createSimpleIcon();
        this.state.tray.setImage(newIcon);
      } catch (fallbackError) {
        console.error('Fallback icon also failed:', fallbackError);
      }
      this.updateTooltipContent();
      this.updateTrayContextMenu();
    }
  }

  /** Linux trays emit no mouse-enter, so the native tooltip lists the readings instead of the popup. */
  private getToolTipText(): string {
    return this.state.readings
      .map((r) => `${r.name}: ${r.stale ? '--' : `${this.formatDisplayNumber(r.value)} ${this.state.currentUnit} ${this.trendText(r.trend)}`}`)
      .join('\n');
  }

  private updateTrayContextMenu(): void {
    if (!this.state.tray) return;

    const readingItems: Electron.MenuItemConstructorOptions[] = this.state.readings.map((r) => ({
      label: r.stale
        ? `${r.name}: --`
        : `${r.name}: ${this.formatDisplayNumber(r.value)} ${this.state.currentUnit} ${this.trendText(r.trend)}`,
    }));

    const contextMenuTemplate: Electron.MenuItemConstructorOptions[] = [
      ...(readingItems.length ? [...readingItems, { type: 'separator' as const }] : []),
      {
        label: 'Bring to Front',
        click: () => {
          const win = this.state.mainWindow;
          if (!win || win.isDestroyed()) return;
          if (win.isMinimized()) win.restore();
          win.show();
          app.focus({ steal: true });
          win.focus();
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ];

    const contextMenu = Menu.buildFromTemplate(contextMenuTemplate);
    this.state.tray.setContextMenu(contextMenu);
  }

  private notifyRenderer(): void {
    if (this.state.mainWindow && !this.state.mainWindow.isDestroyed()) {
      this.state.mainWindow.webContents.send(
        'tray-number-updated',
        this.state.currentNumber,
      );
    }
  }

  // Color utility methods
  private getBackgroundColorForGlucoseLevel(level: number, low?: number, high?: number): RGBAColor {
    const targetLow = low ?? this.state.targetLow;
    const targetHigh = high ?? this.state.targetHigh;

    // Convert level to mg/dL for consistent comparison if unit is mmol/L
    const levelInMgPerDl = this.state.currentUnit === 'mmol/L' ? level * 18 : level;

    if (levelInMgPerDl < LOW) {
      return { r: 239, g: 68, b: 68, a: 255 }; // bg-red-500
    }

    if (levelInMgPerDl > HIGH) {
      return { r: 249, g: 115, b: 22, a: 255 }; // bg-orange-500
    }

    if ((levelInMgPerDl < targetLow && levelInMgPerDl >= LOW) ||
        (levelInMgPerDl > targetHigh && levelInMgPerDl <= HIGH)) {
      return { r: 234, g: 179, b: 8, a: 255 }; // bg-yellow-500
    }

    return { r: 34, g: 197, b: 94, a: 255 }; // bg-green-500
  }

  private getColorForGlucoseLevel(level: number): RGBAColor {
    return { r: 255, g: 255, b: 255, a: 255 };
  }

  // Add helper method to convert RGB to CSS string
  private rgbToCss(color: RGBAColor): string {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
}

// Create singleton instance
const trayManager = new TrayManager();

// Export public API
export const createTray = (window: BrowserWindow) => trayManager.createTray(window);
export const updateTrayReadings = (readings: TrayReading[], unit: string) =>
  trayManager.updateReadings(readings, unit);
export const updateTrayNumber = (newNumber: number, unit: string, targetLow?: number, targetHigh?: number, trendArrow?: number) =>
  trayManager.updateTrayNumber(newNumber, unit, targetLow, targetHigh, trendArrow);
export const updateTrayTargets = (targetLow: number, targetHigh: number) =>
  trayManager.updateTargets(targetLow, targetHigh);
export const destroyTray = () => trayManager.destroyTray();
export const hasTray = () => trayManager.hasTray();
export const isTrayCreated = () => trayManager.getCreationState();
