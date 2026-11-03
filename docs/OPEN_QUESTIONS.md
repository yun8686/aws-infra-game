# Open Questions and Decisions

These are intentionally unresolved. Claude Code should analyze and recommend options rather than silently deciding.

## Blocking decisions

1. **Game engine / UI technology**
   - Native mobile, Flutter, React Native, Unity, or another option?
   - Consider graph editor complexity, performance, iteration speed, and solo development.

2. **Target release**
   - Android first, iOS + Android together, or web prototype first?

3. **Orientation**
   - Portrait-only initially, or support landscape for complex graph editing?

4. **Persistence**
   - Local-only MVP, or account/cloud save from the beginning?

5. **Visual style**
   - Technical dashboard, approachable management game, or stylized game UI?

## Product decisions to settle during MVP design

6. Should simulation be instant, discrete time-step, or timeline playback?
7. Should the player be able to pause and edit during a running incident?
8. How much detail should network routing and security rules have in the first release?
9. Should projects progress on a shared in-game clock, or only when the player starts a scenario?
10. Should free construction be available from the beginning as a sandbox?
11. What is the initial scoring balance among performance, availability, cost, and security?
12. Is the game intended primarily for AWS beginners, working engineers, or both?

## Content decisions

13. Which AWS services are essential for the first playable build?
14. How many tutorial missions are needed?
15. Should the game use AWS trademarks/icons, custom icons, or a hybrid visual language? Review applicable brand and asset usage requirements before release.

## Recommended next decision sequence

1. Choose target platform and technology.
2. Confirm first mission and initial service list.
3. Define graph connection semantics and service configuration schemas.
4. Define the first deterministic simulation model.
5. Build one vertical slice before expanding content.
