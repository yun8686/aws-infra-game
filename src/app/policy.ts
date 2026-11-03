import { MISSIONS, type MissionId } from '../data/missions';
import type { EditPolicy } from '../domain/graph/commands';
import { missionEditPolicy } from '../domain/missions/mission';

export const policyForMission = (missionId: string): EditPolicy => {
  const mission = MISSIONS[missionId as MissionId];
  return mission ? missionEditPolicy(mission) : {};
};
