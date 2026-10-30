// Browser launch settings for the scan sandbox (D-017, D-021). Every request goes through the
// Smokescreen egress proxy, which resolves names itself and refuses non-public addresses.
import type { LaunchOptions } from 'playwright';

/** Chromium options for a sandboxed scan; proxyServer is the in-VM Smokescreen (D-017: :4750). */
export function chromiumLaunchOptions(proxyServer: string): LaunchOptions {
  return {
    proxy: { server: proxyServer },
    // The proxy carries no UDP, so this stops WebRTC (STUN/TURN) from reaching any address directly.
    args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  };
}
