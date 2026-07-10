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

export const DEVICE_PRESETS: Record<string, DevicePreset[]> = {
  mobile: [
    { label: "iPhone SE", width: 375, height: 667, deviceScaleFactor: 2, category: "mobile", mobile: true, touch: true },
    { label: "iPhone 16", width: 390, height: 844, deviceScaleFactor: 3, category: "mobile", mobile: true, touch: true },
    { label: "iPhone 16 Pro", width: 393, height: 852, deviceScaleFactor: 3, category: "mobile", mobile: true, touch: true },
    { label: "iPhone 16 Pro Max", width: 430, height: 932, deviceScaleFactor: 3, category: "mobile", mobile: true, touch: true },
    { label: "iPhone 17 Pro", width: 402, height: 874, deviceScaleFactor: 3, category: "mobile", mobile: true, touch: true },
    { label: "iPhone 17 Pro Max", width: 440, height: 956, deviceScaleFactor: 3, category: "mobile", mobile: true, touch: true },
    { label: "Galaxy S25", width: 360, height: 780, deviceScaleFactor: 3, category: "mobile", mobile: true, touch: true },
    { label: "Galaxy S25 Ultra", width: 412, height: 891, deviceScaleFactor: 3.5, category: "mobile", mobile: true, touch: true },
    { label: "Galaxy S26 Ultra", width: 412, height: 891, deviceScaleFactor: 3.5, category: "mobile", mobile: true, touch: true },
    { label: "Pixel 9", width: 412, height: 915, deviceScaleFactor: 2.625, category: "mobile", mobile: true, touch: true },
    { label: "OnePlus 13", width: 412, height: 905, deviceScaleFactor: 3.5, category: "mobile", mobile: true, touch: true },
  ],
  tablet: [
    { label: "iPad Mini", width: 744, height: 1133, deviceScaleFactor: 2, category: "tablet", mobile: true, touch: true },
    { label: "iPad", width: 820, height: 1180, deviceScaleFactor: 2, category: "tablet", mobile: true, touch: true },
    { label: 'iPad Pro 11"', width: 834, height: 1194, deviceScaleFactor: 2, category: "tablet", mobile: true, touch: true },
    { label: 'iPad Pro 13"', width: 1024, height: 1366, deviceScaleFactor: 2, category: "tablet", mobile: true, touch: true },
    { label: "Galaxy Tab S10 Ultra", width: 924, height: 1480, deviceScaleFactor: 2, category: "tablet", mobile: true, touch: true },
  ],
  laptop: [
    { label: "1280×800", width: 1280, height: 800, deviceScaleFactor: 1, category: "laptop", mobile: false, touch: false },
    { label: "1366×768", width: 1366, height: 768, deviceScaleFactor: 1, category: "laptop", mobile: false, touch: false },
    { label: "1440×900", width: 1440, height: 900, deviceScaleFactor: 1, category: "laptop", mobile: false, touch: false },
    { label: "1920×1080", width: 1920, height: 1080, deviceScaleFactor: 1, category: "laptop", mobile: false, touch: false },
  ],
};
