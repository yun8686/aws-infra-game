import { MISSIONS, type MissionId } from '../content';
import { missionEditPolicy } from '../game';
import type { EditPolicy } from '../model';

export const policyForMission = (missionId: string): EditPolicy => {
  const mission = MISSIONS[missionId as MissionId];
  return mission ? missionEditPolicy(mission) : {};
};
