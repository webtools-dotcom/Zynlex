export interface UserAgentPreset {
  label: string;
  ua: string;
  category: "desktop" | "mobile" | "bot";
}

export const UA_PRESETS: UserAgentPreset[] = [
  {
    label: "Chrome 125 (Windows)",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    category: "desktop",
  },
  {
    label: "Firefox 128 (Windows)",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
    category: "desktop",
  },
  {
    label: "Safari 17.5 (macOS)",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    category: "desktop",
  },
  {
    label: "Edge 125 (Windows)",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
    category: "desktop",
  },
  {
    label: "Chrome (Android 14)",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    category: "mobile",
  },
  {
    label: "Safari (iOS 17.5)",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    category: "mobile",
  },
  {
    label: "Samsung Browser (Android)",
    ua: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    category: "mobile",
  },
  {
    label: "Googlebot",
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    category: "bot",
  },
  {
    label: "Bingbot",
    ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    category: "bot",
  },
];
