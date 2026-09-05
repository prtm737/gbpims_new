import logoAsset from "@/assets/gbpims-logo.png.asset.json";
import upiQrAsset from "@/assets/gbp-upi-qr.jpg.asset.json";

export const BRAND = {
  short: "GBPIMS",
  name: "Guwahati Biotech Park Incubatee Management System",
  org: "Guwahati Biotech Park",
  logoUrl: logoAsset.url,
  /** Official park UPI QR code (paytm.s10f91q@pta) printed on every bill. */
  upiQrUrl: upiQrAsset.url,
} as const;


const dataUrlCache = new Map<string, string>();

async function toDataUrl(url: string): Promise<string | null> {
  const hit = dataUrlCache.get(url);
  if (hit) return hit;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const out = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("asset read failed"));
      reader.readAsDataURL(blob);
    });
    dataUrlCache.set(url, out);
    return out;
  } catch {
    return null;
  }
}

/** Official park UPI QR as a data URL, cached — printed on generated bills. */
export async function getUpiQrDataUrl(): Promise<string | null> {
  return toDataUrl(BRAND.upiQrUrl);
}

let logoDataUrl: string | null = null;

/** Logo as a data URL, cached — used when embedding the mark in generated PDFs. */
export async function getLogoDataUrl(): Promise<string | null> {
  if (logoDataUrl) return logoDataUrl;

  try {
    const res = await fetch(BRAND.logoUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    logoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("logo read failed"));
      reader.readAsDataURL(blob);
    });
    return logoDataUrl;
  } catch {
    return null;
  }
}
