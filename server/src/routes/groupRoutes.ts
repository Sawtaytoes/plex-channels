import { Hono } from 'hono';

import { errMessage } from '../errors.js';
import { resolveGroups, unassignedSetIds } from '../groups.js';
import * as sets from '../sets.js';

/**
 * `GET /api/groups` — every QueuePilot group with its resolved membership.
 *
 * NOT `/api/profiles`, which is Plex's Home profile list and predates this by months. The
 * collision is the reason the concept is called a group at all; see `groups.ts`.
 *
 * Resolved SERVER-side rather than shipping the rules to the browser, because membership
 * reads a set's provider accounts (`requires_profile`, a rotation binding's `plex_user`, a
 * block's `profile`) and those are engine facts. A second implementation in TypeScript on
 * the client is a second answer to "whose is this", and the first thing that would drift is
 * the explicit-beats-derived ordering.
 *
 * `unassigned` rides along so the UI can say "these are filed nowhere" without asking a
 * second time or re-deriving anything.
 */
export function groupRoutes(): Hono {
  const app = new Hono();

  app.get('/groups', async (c) => {
    try {
      const reg = await sets.getRegistry();
      return c.json({
        groups: resolveGroups(reg.sets),
        unassigned: unassignedSetIds(reg.sets),
      });
    } catch (e) {
      return c.json({ error: errMessage(e) }, 500);
    }
  });

  return app;
}
