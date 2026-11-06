import { Fragment, useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  ScreenImage,
  ScreenSpaceUI,
  ScreenText,
} from "@vincentt-xr/sdk";
import {
  GestureTracker,
  useFaceInfo,
} from "@vincentt-xr/sdk/tracking";

import { useGestureHold } from "./gesture";

const CANVAS = { width: 720, height: 1280 };
const COUNTDOWN_SECONDS = 4;
const STICK_COUNT = 8;
const HAND_Y = -430;
const HAND_W = 230;
const HAND_H = 190;
const STICK_SLOT_XS = [-236, -171, -106, -41, 39, 104, 169, 234];
const MISS_OFFSCREEN_Y = 760;
const STICK_Y = 395;
const STICK_W = 58;
const STICK_H = 230;
const CATCH_Y = HAND_Y + 54;

type StickStatus = "waiting" | "falling" | "caught" | "missed";

type Stick = {
  id: number;
  status: StickStatus;
  releasedAt: number | null;
  resolvedAt: number | null;
};

const makeSticks = (): Stick[] =>
  Array.from({ length: STICK_COUNT }, (_, id) => ({
    id,
    status: "waiting",
    releasedAt: null,
    resolvedAt: null,
  }));

const shuffle = () => {
  const order = Array.from({ length: STICK_COUNT }, (_, id) => id);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

const nextDelay = () => 0.35 + Math.random() * 0.75;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const overlaps = (
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
) => Math.abs(ax - bx) < (aw + bw) / 2 && Math.abs(ay - by) < (ah + bh) / 2;

export const Scene = ({
  onHudTextChange,
}: {
  onHudTextChange?: (next: { timeText: string; caughtText: string }) => void;
}) => {
  const face = useFaceInfo({ targetFps: 24, holdMs: 350 });
  const headCenterRef = useRef<number | null>(null);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sticks, setSticks] = useState(makeSticks);
  const [releaseOrder, setReleaseOrder] = useState<number[]>([]);
  const [nextReleaseAt, setNextReleaseAt] = useState(0);
  const [handX, setHandX] = useState(0);

  const caught = sticks.filter((stick) => stick.status === "caught").length;
  const missed = sticks.filter((stick) => stick.status === "missed").length;
  const resolved = caught + missed;
  const finalMissed = STICK_COUNT - caught;
  const gameElapsed = Math.max(0, elapsed - COUNTDOWN_SECONDS);
  const timeSeconds = Math.floor(gameElapsed);
  const timeText = `Time : ${timeSeconds} sec`;
  const caughtText = `Caught : ${caught} / ${STICK_COUNT}`;

  useEffect(() => {
    onHudTextChange?.({ timeText, caughtText });
  }, [caughtText, onHudTextChange, timeText]);
  let countdownText = "";
  if (started && elapsed < 1) countdownText = "3";
  else if (started && elapsed < 2) countdownText = "2";
  else if (started && elapsed < 3) countdownText = "1";
  else if (started && elapsed < 4) countdownText = "GO!";
  const won = caught === STICK_COUNT;
  const failed = resolved === STICK_COUNT && !won;
  const active = elapsed >= COUNTDOWN_SECONDS && !won && !failed;
  const pregame = elapsed < COUNTDOWN_SECONDS;
  const readyForDrop =
    active && sticks.every((stick) => stick.status !== "falling");
  // A hidden ScreenText still rebuilds its texture when a prop changes, so animate only while shown.
  const wobble = (on: boolean, base: number, amp: number, speed: number) =>
    on ? base + Math.sin(elapsed * speed) * amp : base;

  const startGame = () => {
    // Capture the current face center as the baseline for head movement.
    headCenterRef.current = face?.bounds.centerX ?? null;
    setReleaseOrder(shuffle());
    setNextReleaseAt(nextDelay());
    setStarted(true);
  };

  const resetGame = () => {
    // Reset the board and restart from the same start flow as a fresh game.
    headCenterRef.current = face?.bounds.centerX ?? null;
    setStarted(true);
    setElapsed(0);
    setSticks(makeSticks());
    setReleaseOrder(shuffle());
    setNextReleaseAt(nextDelay());
    setHandX(0);
  };

  useGestureHold({
    gesture: "victory",
    holdMs: 450,
    enabled: !started || won || failed,
    onTrigger: started ? resetGame : startGame,
  });

  useFrame((_, delta) => {
    const centerX = face?.bounds.centerX;
    if (typeof centerX === "number") {
      headCenterRef.current ??= centerX;
      const headMove = centerX - headCenterRef.current;
      setHandX(
        (current) =>
          current + (clamp(headMove * 1400, -275, 275) - current) * 0.25,
      );
    }

    if (!started || won || failed) return;
    const nextElapsed = elapsed + delta;
    setElapsed(nextElapsed);
    if (nextElapsed < COUNTDOWN_SECONDS) return;
    const nextGameElapsed = nextElapsed - COUNTDOWN_SECONDS;
    setSticks((current) => {
      const falling = current.find((stick) => stick.status === "falling");
      if (!falling && nextGameElapsed >= nextReleaseAt) {
        // Only release one waiting stick at a time, in shuffled order.
        const nextId = releaseOrder.find(
          (id) => current[id]?.status === "waiting",
        );
        if (nextId !== undefined) {
          return current.map((stick) =>
            stick.id === nextId
              ? { ...stick, status: "falling", releasedAt: nextGameElapsed }
              : stick,
          );
        }
      }

      if (!falling || falling.releasedAt === null) return current;
      const speed = 1.15 + caught * 0.08;
      const y = STICK_Y - (nextGameElapsed - falling.releasedAt) * 520 * speed;
      const x = STICK_SLOT_XS[falling.id] ?? 0;
      const didCatch =
        Math.abs(y - CATCH_Y) < 95 &&
        overlaps(x, y, STICK_W, STICK_H, handX + 46, CATCH_Y, 90, 90);
      const didMiss = y < CATCH_Y - 105;
      if (!didCatch && !didMiss) return current;
      // Advance the next drop only after the current stick is resolved.
      setNextReleaseAt(nextGameElapsed + nextDelay());
      return current.map((stick) =>
        stick.id === falling.id
          ? {
              ...stick,
              status: didCatch ? "caught" : "missed",
              // Store game time so the feedback pulse stays in game-clock sync.
              resolvedAt: nextGameElapsed,
            }
          : stick,
      );
    });
  });

  return (
    <>
      <GestureTracker active={!started || won || failed} />

      <ScreenSpaceUI>
        {sticks.map((stick) => {
          const x = STICK_SLOT_XS[stick.id] ?? 0;
          const swayY = Math.sin(elapsed * 1.8 + stick.id * 0.4) * 5;
          const speed = 1.15 + caught * 0.08;
          const fallingY =
            stick.releasedAt === null
              ? STICK_Y
              : STICK_Y - (gameElapsed - stick.releasedAt) * 520 * speed;
          let y = STICK_Y + swayY;
          if (stick.status === "falling") y = fallingY;
          else if (stick.status === "missed") y = MISS_OFFSCREEN_Y;
          const catchPulse =
            stick.status !== "caught" ||
            stick.resolvedAt === null ||
            won ||
            failed
              ? 0
              : clamp(1 - (elapsed - stick.resolvedAt) / 0.32, 0, 1);
          const missPulse =
            stick.status !== "missed" || stick.resolvedAt === null || won
              ? 0
              : clamp(1 - (elapsed - stick.resolvedAt) / 0.45, 0, 1);
          const catchRise = catchPulse * 28;
          const missShake =
            missPulse > 0 ? Math.sin(elapsed * 48) * 7 * missPulse : 0;
          return (
            <Fragment key={stick.id}>
              <ScreenImage
                name={`stick-${stick.id + 1}`}
                src="/images/Stick.png"
                coordinateSpace="canvas"
                canvasSize={CANVAS}
                position={[x + missShake, y]}
                size={[STICK_W, STICK_H]}
                fit="contain"
                visible={
                  stick.status !== "caught" &&
                  stick.status !== "missed" &&
                  missPulse < 0.02
                }
                opacity={stick.status === "caught" ? 0 : 1 - missPulse}
                renderOrder={20}
              />
              {catchPulse > 0 && (
                <ScreenText
                  name="Catch +1"
                  text="+1"
                  screenTransform={{
                    position: { x, y: y + catchRise },
                    size: { width: 280, height: 280 },
                    renderOrder: 0,
                  }}
                  fontSize={46 * (1 + catchPulse)}
                  color="#ffffff"
                  bgColor="transparent"
                  padding={0}
                  strokeColor="#1f7a37"
                  strokeWidth={2.7 * (1 + catchPulse)}
                  shadowColor="#ffca3a"
                  shadowBlur={4.9 * (1 + catchPulse)}
                  shadowOpacity={catchPulse}
                />
              )}
              {missPulse > 0 && (
                <ScreenText
                  name="Miss"
                  text="MISS"
                  screenTransform={{
                    position: { x: x + missShake, y },
                    size: { width: 180, height: 80 },
                    renderOrder: 0,
                  }}
                  fontSize={17}
                  color="#ffffff"
                  bgColor="transparent"
                  padding={0}
                  strokeColor="#9f1239"
                  strokeWidth={1.25}
                  shadowColor="#fb7185"
                  shadowBlur={2.2}
                  shadowOpacity={missPulse}
                />
              )}
            </Fragment>
          );
        })}

        <ScreenImage
          name="holder"
          src="/images/Holder.png"
          coordinateSpace="canvas"
          canvasSize={CANVAS}
          position={[0, 560 + Math.sin(elapsed * 1.8) * 5]}
          size={[650, 210]}
          fit="contain"
          renderOrder={40}
        />

        <ScreenImage
          name="hand"
          src="/images/Hand.png"
          coordinateSpace="canvas"
          canvasSize={CANVAS}
          position={[handX, HAND_Y + Math.sin(elapsed * 5) * 4]}
          size={[HAND_W, HAND_H]}
          fit="contain"
          renderOrder={30}
        />

        <ScreenText
          name="Hand marker"
          text="○"
          screenTransform={{
            position: { x: handX + 46, y: HAND_Y + 54 },
            size: { width: 76, height: 76 },
            renderOrder: 0,
          }}
          fontSize={30}
          color="#ffffff"
          bgColor="transparent"
          padding={0}
          strokeColor="#38bdf8"
          strokeWidth={0.75}
          shadowColor="#38bdf8"
          shadowBlur={2.1 + Math.sin(elapsed * 7) * 0.75}
          shadowOpacity={0.8}
        />

        {/* One literal ScreenText per message, so the console's visual editor can retype and
            move each; game state only toggles `visible`. */}
        <ScreenText
          name="Start prompt"
          text="Show Peace Sign to Start Game"
          screenTransform={{ position: { x: 0, y: -83 }, size: { width: 590, height: 115 }, rotation: 0, renderOrder: 0 }}
          fontSize={27}
          color="#ffffff"
          bgColor="transparent"
          padding={0}
          strokeColor="#2f1b0c"
          strokeWidth={2.25}
          shadowColor="#ffca3a"
          shadowBlur={wobble(!started, 4, 1.8, 6)}
          shadowOpacity={0.85}
          shadowOffsetY={0.9}
          glow={{ color: "#ffca3a", style: "outward", intensity: 0.65, range: 0.225 }}
          visible={!started}
        />
        <ScreenText
          name="Move head prompt"
          text="Move your head left and right"
          screenTransform={{ position: { x: 0, y: -106 }, size: { width: 547, height: 109 }, rotation: 0, renderOrder: 0 }}
          fontSize={23}
          color="#ffffff"
          bgColor="transparent"
          padding={0}
          strokeColor="#2f1b0c"
          strokeWidth={1.9}
          shadowColor="#38bdf8"
          shadowBlur={3.4}
          visible={started && pregame}
        />
        <ScreenText
          name="Countdown 3"
          text="3"
          screenTransform={{ position: { x: 0, y: 13 }, size: { width: 259, height: 256 }, rotation: 0, renderOrder: 0 }}
          fontSize={150}
          color="#ffffff"
          bgColor="transparent"
          padding={0}
          strokeColor="#2f1b0c"
          strokeWidth={8}
          shadowColor="#ffca3a"
          shadowBlur={wobble(countdownText === "3", 12, 4, 12)}
          visible={countdownText === "3"}
        />
        <ScreenText
          name="Countdown 2"
          text="2"
          screenTransform={{ position: { x: 0, y: 13 }, size: { width: 259, height: 256 }, rotation: 0, renderOrder: 0 }}
          fontSize={150}
          color="#ffffff"
          bgColor="transparent"
          padding={0}
          strokeColor="#2f1b0c"
          strokeWidth={8}
          shadowColor="#ffca3a"
          shadowBlur={wobble(countdownText === "2", 12, 4, 12)}
          visible={countdownText === "2"}
        />
        <ScreenText
          name="Countdown 1"
          text="1"
          screenTransform={{ position: { x: 0, y: 13 }, size: { width: 259, height: 256 }, rotation: 0, renderOrder: 0 }}
          fontSize={150}
          color="#ffffff"
          bgColor="transparent"
          padding={0}
          strokeColor="#2f1b0c"
          strokeWidth={8}
          shadowColor="#ffca3a"
          shadowBlur={wobble(countdownText === "1", 12, 4, 12)}
          visible={countdownText === "1"}
        />
        <ScreenText
          name="Countdown GO"
          text="GO!"
          screenTransform={{ position: { x: 0, y: 13 }, size: { width: 259, height: 256 }, rotation: 0, renderOrder: 0 }}
          fontSize={115}
          color="#ffffff"
          bgColor="transparent"
          padding={0}
          strokeColor="#2f1b0c"
          strokeWidth={8}
          shadowColor="#ffca3a"
          shadowBlur={wobble(countdownText === "GO!", 12, 4, 12)}
          visible={countdownText === "GO!"}
        />
        <ScreenText
          name="Ready"
          text="READY"
          screenTransform={{ position: { x: 0, y: 6 }, size: { width: 230, height: 90 }, rotation: 0, renderOrder: 0 }}
          fontSize={24}
          color="#ffffff"
          bgColor="transparent"
          padding={0}
          strokeColor="#2f1b0c"
          strokeWidth={1.6}
          shadowColor="#ffca3a"
          shadowBlur={wobble(readyForDrop, 2.8, 0.9, 8)}
          visible={readyForDrop}
        />
        <ScreenText
          name="You win"
          text="YOU WIN"
          screenTransform={{ position: { x: 0, y: 45 }, size: { width: 446, height: 128 }, rotation: 0, renderOrder: 0 }}
          fontSize={52}
          color="#ffffff"
          bgColor="rgba(31, 122, 55, 0.9)"
          borderRadius={6.5}
          padding={8}
          visible={won}
        />
        <ScreenText
          name="Missed count"
          text={`MISSED ${finalMissed}`}
          screenTransform={{ position: { x: 0, y: 45 }, size: { width: 446, height: 128 }, rotation: 0, renderOrder: 0 }}
          fontSize={52}
          color="#ffffff"
          bgColor="rgba(170, 45, 35, 0.9)"
          borderRadius={6.5}
          padding={8}
          visible={failed}
        />
        <ScreenText
          name="Reset prompt"
          text="Show Peace Sign to Reset Game"
          screenTransform={{ position: { x: 0, y: -134 }, size: { width: 590, height: 115 }, rotation: 0, renderOrder: 0 }}
          fontSize={27}
          color="#ffffff"
          bgColor="transparent"
          padding={0}
          strokeColor="#2f1b0c"
          strokeWidth={2.25}
          shadowColor="#ffca3a"
          shadowBlur={wobble(won || failed, 4, 1.8, 6)}
          shadowOpacity={0.85}
          shadowOffsetY={0.9}
          glow={{
            color: "#ffca3a",
            style: "outward",
            intensity: wobble(won || failed, 0.65, 0.2, 6),
            range: 0.225,
          }}
          visible={won || failed}
        />
      </ScreenSpaceUI>
    </>
  );
};
