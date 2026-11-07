/**
 * SENTRA Indoor Navigation & Path Planning Service
 * Feature 6: Intelligent Indoor Navigation and Path Planning
 *
 * Implements:
 * 1. Topological & geometric indoor navigation graph (rooms, hallways, doors, landmarks).
 * 2. Real A* Pathfinding algorithm over mapped waypoints.
 * 3. Step-by-step human-friendly landmark guidance (clock positions, human steps).
 * 4. Safety protocol: Explicit visual landmark assistance, re-observation prompts, obstacle avoidance.
 */

import { NavigationNode, NavigationEdge, NavigationRoute, NavigationRouteStep } from '../types/sentra';

const DEFAULT_MAP_NODES: NavigationNode[] = [
  { id: 'node-entrance', name: 'Front Entrance Door', room: 'Entrance', x: 0, y: 0, clearanceWidthMeters: 1.2 },
  { id: 'node-hallway', name: 'Main Hallway', room: 'Hallway', x: 0, y: 4, clearanceWidthMeters: 1.5 },
  { id: 'node-living', name: 'Living Room Center', room: 'Living Room', x: -4, y: 5, clearanceWidthMeters: 2.0 },
  { id: 'node-desk', name: 'Study Desk', room: 'Study', x: -5, y: 8, clearanceWidthMeters: 1.1 },
  { id: 'node-kitchen', name: 'Kitchen Doorway', room: 'Kitchen', x: 3, y: 6, clearanceWidthMeters: 1.0 },
  { id: 'node-dining', name: 'Dining Table', room: 'Dining', x: 2, y: 9, clearanceWidthMeters: 1.8 },
];

const DEFAULT_MAP_EDGES: NavigationEdge[] = [
  { from: 'node-entrance', to: 'node-hallway', distanceSteps: 5, headingDeg: 0, isClear: true },
  { from: 'node-hallway', to: 'node-entrance', distanceSteps: 5, headingDeg: 180, isClear: true },

  { from: 'node-hallway', to: 'node-living', distanceSteps: 6, headingDeg: 270, isClear: true },
  { from: 'node-living', to: 'node-hallway', distanceSteps: 6, headingDeg: 90, isClear: true },

  { from: 'node-living', to: 'node-desk', distanceSteps: 4, headingDeg: 345, isClear: true },
  { from: 'node-desk', to: 'node-living', distanceSteps: 4, headingDeg: 165, isClear: true },

  { from: 'node-hallway', to: 'node-kitchen', distanceSteps: 4, headingDeg: 60, isClear: true },
  { from: 'node-kitchen', to: 'node-hallway', distanceSteps: 4, headingDeg: 240, isClear: true },

  { from: 'node-kitchen', to: 'node-dining', distanceSteps: 4, headingDeg: 30, isClear: true },
  { from: 'node-dining', to: 'node-kitchen', distanceSteps: 4, headingDeg: 210, isClear: true },
];

export class IndoorNavigationService {
  private nodes: Map<string, NavigationNode> = new Map();
  private edges: NavigationEdge[] = [];
  private activeRoute: NavigationRoute | null = null;

  constructor() {
    DEFAULT_MAP_NODES.forEach((n) => this.nodes.set(n.id, n));
    this.edges = [...DEFAULT_MAP_EDGES];
  }

  public getAvailableDestinations(): Array<{ id: string; name: string; room: string }> {
    return Array.from(this.nodes.values()).map((n) => ({
      id: n.id,
      name: n.name,
      room: n.room,
    }));
  }

  /**
   * Updates an edge's obstacle clearance dynamically from ToF sensor or camera detection.
   */
  public updateEdgeClearance(fromNodeId: string, toNodeId: string, isClear: boolean, hazardNote?: string) {
    const edge = this.edges.find((e) => (e.from === fromNodeId && e.to === toNodeId) || (e.from === toNodeId && e.to === fromNodeId));
    if (edge) {
      edge.isClear = isClear;
      edge.hazardNote = hazardNote;
    }
  }

  /**
   * Plan route using A* Pathfinding algorithm.
   */
  public planRoute(
    currentRoomOrNodeName: string,
    targetDestinationName: string,
    userHeading: number | null = null
  ): NavigationRoute | null {
    const startNode = this.findNearestNode(currentRoomOrNodeName) || this.nodes.get('node-hallway');
    const endNode = this.findNearestNode(targetDestinationName);

    if (!startNode || !endNode || startNode.id === endNode.id) {
      return null;
    }

    const pathNodeIds = this.runAStar(startNode.id, endNode.id);
    if (!pathNodeIds || pathNodeIds.length < 2) {
      return null;
    }

    // Convert path into natural human-centric checkpoint steps
    const steps: NavigationRouteStep[] = [];
    let totalSteps = 0;

    for (let i = 0; i < pathNodeIds.length - 1; i++) {
      const fromId = pathNodeIds[i];
      const toId = pathNodeIds[i + 1];
      const fromNode = this.nodes.get(fromId)!;
      const toNode = this.nodes.get(toId)!;
      const edge = this.edges.find((e) => e.from === fromId && e.to === toId);

      const heading = edge?.headingDeg ?? 0;
      const distSteps = edge?.distanceSteps ?? 4;
      totalSteps += distSteps;

      // Clock position relative to user heading
      const relativeClock = this.calculateClockPosition(userHeading, heading);

      const instruction =
        i === 0
          ? `Face ${relativeClock} towards the ${toNode.name}. Walk forward about ${distSteps} steps.`
          : i === pathNodeIds.length - 2
          ? `Turn towards ${relativeClock}. Your destination, ${endNode.name}, is visible ahead.`
          : `Continue through ${toNode.room} at ${relativeClock} for ${distSteps} steps.`;

      steps.push({
        stepNumber: i + 1,
        instruction,
        targetHeading: heading,
        clockPosition: relativeClock,
        stepsEstimate: distSteps,
        checkpointLandmark: toNode.name,
        requiresVerification: true,
        isCompleted: false,
      });
    }

    const route: NavigationRoute = {
      routeId: `route-${Date.now()}`,
      destination: endNode.name,
      destinationNodeId: endNode.id,
      totalSteps,
      currentStepIndex: 0,
      steps,
      status: 'navigating',
      confidence: 'high',
    };

    this.activeRoute = route;
    return route;
  }

  /**
   * Classic A* Search Algorithm
   */
  private runAStar(startId: string, goalId: string): string[] | null {
    const openSet = new Set<string>([startId]);
    const cameFrom = new Map<string, string>();

    const gScore = new Map<string, number>();
    gScore.set(startId, 0);

    const fScore = new Map<string, number>();
    fScore.set(startId, this.heuristic(startId, goalId));

    while (openSet.size > 0) {
      // Find node with lowest fScore
      let current: string | null = null;
      let lowestF = Infinity;
      for (const id of openSet) {
        const f = fScore.get(id) ?? Infinity;
        if (f < lowestF) {
          lowestF = f;
          current = id;
        }
      }

      if (!current) break;

      if (current === goalId) {
        // Reconstruct path
        const path = [current];
        while (cameFrom.has(current)) {
          current = cameFrom.get(current)!;
          path.unshift(current);
        }
        return path;
      }

      openSet.delete(current);

      // Explore neighbors
      const neighbors = this.edges
        .filter((e) => e.from === current && e.isClear)
        .map((e) => ({ to: e.to, weight: e.distanceSteps }));

      for (const neighbor of neighbors) {
        const tentativeG = (gScore.get(current) ?? Infinity) + neighbor.weight;

        if (tentativeG < (gScore.get(neighbor.to) ?? Infinity)) {
          cameFrom.set(neighbor.to, current);
          gScore.set(neighbor.to, tentativeG);
          fScore.set(neighbor.to, tentativeG + this.heuristic(neighbor.to, goalId));

          if (!openSet.has(neighbor.to)) {
            openSet.add(neighbor.to);
          }
        }
      }
    }

    return null;
  }

  private heuristic(nodeAId: string, nodeBId: string): number {
    const a = this.nodes.get(nodeAId);
    const b = this.nodes.get(nodeBId);
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private findNearestNode(query: string): NavigationNode | null {
    const clean = query.toLowerCase().trim();
    for (const node of this.nodes.values()) {
      if (
        node.name.toLowerCase().includes(clean) ||
        node.room.toLowerCase().includes(clean) ||
        clean.includes(node.room.toLowerCase())
      ) {
        return node;
      }
    }
    return null;
  }

  private calculateClockPosition(userHeading: number | null, targetHeading: number): string {
    if (userHeading == null) return "12 o'clock ahead";
    const delta = (targetHeading - userHeading + 360) % 360;

    if (delta >= 345 || delta < 15) return "12 o'clock straight ahead";
    if (delta >= 15 && delta < 45) return "1 o'clock";
    if (delta >= 45 && delta < 75) return "2 o'clock";
    if (delta >= 75 && delta < 105) return "3 o'clock to your right";
    if (delta >= 105 && delta < 135) return "4 o'clock";
    if (delta >= 135 && delta < 165) return "5 o'clock";
    if (delta >= 165 && delta < 195) return "6 o'clock behind you";
    if (delta >= 195 && delta < 225) return "7 o'clock";
    if (delta >= 225 && delta < 255) return "8 o'clock";
    if (delta >= 255 && delta < 285) return "9 o'clock to your left";
    if (delta >= 285 && delta < 315) return "10 o'clock";
    return "11 o'clock";
  }

  public getActiveRoute(): NavigationRoute | null {
    return this.activeRoute;
  }

  public cancelRoute() {
    this.activeRoute = null;
  }
}

export const indoorNavigation = new IndoorNavigationService();
