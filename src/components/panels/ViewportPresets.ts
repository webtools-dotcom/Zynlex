export interface DevicePreset {
  label: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  category: "mobile" | "tablet" | "laptop";
  mobile: boolean;
  touch: boolean;
  userAgent?: string;
}

// Set on the webview at build time, so the very first document request carries
// it — a post-navigation override is too late for server-side mobile detection.
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_TABLET_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-X926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export const DEVICE_PRESETS: Record<string, DevicePreset[]> = {
  mobile: [
    {
      label: "iPhone SE",
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: IPHONE_UA,
    },
    {
      label: "iPhone 16",
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: IPHONE_UA,
    },
    {
      label: "iPhone 16 Pro",
      width: 393,
      height: 852,
      deviceScaleFactor: 3,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: IPHONE_UA,
    },
    {
      label: "iPhone 16 Pro Max",
      width: 430,
      height: 932,
      deviceScaleFactor: 3,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: IPHONE_UA,
    },
    {
      label: "iPhone 17 Pro",
      width: 402,
      height: 874,
      deviceScaleFactor: 3,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: IPHONE_UA,
    },
    {
      label: "iPhone 17 Pro Max",
      width: 440,
      height: 956,
      deviceScaleFactor: 3,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: IPHONE_UA,
    },
    {
      label: "Galaxy S25",
      width: 360,
      height: 780,
      deviceScaleFactor: 3,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: ANDROID_UA,
    },
    {
      label: "Galaxy S25 Ultra",
      width: 412,
      height: 891,
      deviceScaleFactor: 3.5,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: ANDROID_UA,
    },
    {
      label: "Galaxy S26 Ultra",
      width: 412,
      height: 891,
      deviceScaleFactor: 3.5,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: ANDROID_UA,
    },
    {
      label: "Pixel 9",
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: ANDROID_UA,
    },
    {
      label: "OnePlus 13",
      width: 412,
      height: 905,
      deviceScaleFactor: 3.5,
      category: "mobile",
      mobile: true,
      touch: true,
      userAgent: ANDROID_UA,
    },
  ],
  tablet: [
    {
      label: "iPad Mini",
      width: 744,
      height: 1133,
      deviceScaleFactor: 2,
      category: "tablet",
      mobile: true,
      touch: true,
      userAgent: IPAD_UA,
    },
    {
      label: "iPad",
      width: 820,
      height: 1180,
      deviceScaleFactor: 2,
      category: "tablet",
      mobile: true,
      touch: true,
      userAgent: IPAD_UA,
    },
    {
      label: 'iPad Pro 11"',
      width: 834,
      height: 1194,
      deviceScaleFactor: 2,
      category: "tablet",
      mobile: true,
      touch: true,
      userAgent: IPAD_UA,
    },
    {
      label: 'iPad Pro 13"',
      width: 1024,
      height: 1366,
      deviceScaleFactor: 2,
      category: "tablet",
      mobile: true,
      touch: true,
      userAgent: IPAD_UA,
    },
    {
      label: "Galaxy Tab S10 Ultra",
      width: 924,
      height: 1480,
      deviceScaleFactor: 2,
      category: "tablet",
      mobile: true,
      touch: true,
      userAgent: ANDROID_TABLET_UA,
    },
  ],
  laptop: [
    {
      label: "1280×800",
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      category: "laptop",
      mobile: false,
      touch: false,
    },
    {
      label: "1366×768",
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      category: "laptop",
      mobile: false,
      touch: false,
    },
    {
      label: "1440×900",
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      category: "laptop",
      mobile: false,
      touch: false,
    },
    {
      label: "1920×1080",
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      category: "laptop",
      mobile: false,
      touch: false,
    },
  ],
};
