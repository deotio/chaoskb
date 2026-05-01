import { createSyncClient } from '../tools/sync-client.js';

interface Notification {
  id: string;
  type: string;
  deviceInfo?: {
    hostname?: string;
    platform?: string;
    arch?: string;
    osVersion?: string;
    deviceModel?: string | null;
    location?: string | null;
  };
  timestamp: string;
}

/**
 * `chaoskb-mcp notifications list`
 *
 * Shows unacknowledged notifications (new device linked, device revoked, etc.)
 */
export async function notificationsListCommand(): Promise<void> {
  const { signedFetch } = await createSyncClient();

  const resp = await signedFetch('GET', '/v1/notifications');
  if (!resp.ok) {
    const err = await resp.text();
    console.error(`Failed to fetch notifications: ${resp.status} ${err}`);
    process.exit(1);
  }

  const data = await resp.json() as { notifications: Notification[] };

  if (data.notifications.length === 0) {
    console.log('');
    console.log('  No new notifications.');
    console.log('');
    return;
  }

  console.log('');
  console.log(`  ${data.notifications.length} notification(s)`);
  console.log('  ========================');

  for (const n of data.notifications) {
    console.log('');
    const time = new Date(n.timestamp).toLocaleString();
    const type = n.type === 'device_linked' ? 'New device linked'
      : n.type === 'device_revoked' ? 'Device revoked'
      : n.type === 'key_rotated' ? 'Key rotated'
      : n.type;

    console.log(`  ${type}  (${time})`);

    if (n.deviceInfo) {
      const d = n.deviceInfo;
      if (d.hostname) console.log(`    Hostname: ${d.hostname}`);
      if (d.platform && d.osVersion) console.log(`    OS:       ${d.platform} ${d.osVersion} (${d.arch ?? 'unknown'})`);
      if (d.deviceModel) console.log(`    Device:   ${d.deviceModel}`);
      if (d.location) console.log(`    Location: ${d.location}`);
    }

    console.log(`    ID: ${n.id}`);
  }
  console.log('');
}

/**
 * `chaoskb-mcp notifications dismiss [id]`
 *
 * Dismiss a specific notification or all notifications.
 */
export async function notificationsDismissCommand(id?: string): Promise<void> {
  const { signedFetch } = await createSyncClient();

  if (id) {
    const urlPath = `/v1/notifications/${encodeURIComponent(id)}/dismiss`;
    const resp = await signedFetch('POST', urlPath);
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`Failed to dismiss notification: ${resp.status} ${err}`);
      process.exit(1);
    }
    console.log('  Notification dismissed.');
  } else {
    // Dismiss all: fetch list, then dismiss each
    const listResp = await signedFetch('GET', '/v1/notifications');
    if (!listResp.ok) {
      console.error(`Failed to fetch notifications: ${listResp.status}`);
      process.exit(1);
    }

    const data = await listResp.json() as { notifications: Notification[] };
    if (data.notifications.length === 0) {
      console.log('  No notifications to dismiss.');
      return;
    }

    for (const n of data.notifications) {
      const urlPath = `/v1/notifications/${encodeURIComponent(n.id)}/dismiss`;
      await signedFetch('POST', urlPath);
    }
    console.log(`  ${data.notifications.length} notification(s) dismissed.`);
  }
}
