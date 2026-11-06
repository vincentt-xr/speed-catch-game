import { Fragment, useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  ScreenImage,
  ScreenSpaceUI,
  ScreenTransform,
  TextLabel,
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
                <ScreenTransform
                  anchors={{
                    left: (x - 70 * (1 + catchPulse)) / 360,
                    right: (x + 70 * (1 + catchPulse)) / 360,
                    top: (y + catchRise + 70 * (1 + catchPulse)) / 640,
                    bottom: (y + catchRise - 70 * (1 + catchPulse)) / 640,
                  }}
                >
                  <TextLabel
                    text="+1"
                    fontSize={170}
                    color="#ffffff"
                    bgColor="transparent"
                    strokeColor="#1f7a37"
                    strokeWidth={10}
                    shadowColor="#ffca3a"
                    shadowBlur={18}
                    shadowOpacity={catchPulse}
                    aspect={2}
                  />
                </ScreenTransform>
              )}
              {missPulse > 0 && (
                <ScreenTransform
                  anchors={{
                    left: (x - 90) / 360,
                    right: (x + 90) / 360,
                    top: (y + 40) / 640,
                    bottom: (y - 40) / 640,
                  }}
                >
                  <TextLabel
                    text="MISS"
                    fontSize={110}
                    color="#ffffff"
                    bgColor="transparent"
                    strokeColor="#9f1239"
                    strokeWidth={8}
                    shadowColor="#fb7185"
                    shadowBlur={14}
                    shadowOpacity={missPulse}
                    aspect={2.8}
                  />
                </ScreenTransform>
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

        <ScreenTransform
          anchors={{
            left: (handX + 8) / 360,
            right: (handX + 84) / 360,
            top: (HAND_Y + 92) / 640,
            bottom: (HAND_Y + 16) / 640,
          }}
        >
          <TextLabel
            text="○"
            fontSize={205}
            color="#ffffff"
            bgColor="transparent"
            strokeColor="#38bdf8"
            strokeWidth={5}
            shadowColor="#38bdf8"
            shadowBlur={14 + Math.sin(elapsed * 7) * 5}
            shadowOpacity={0.8}
            aspect={1}
          />
        </ScreenTransform>

        {!started && (
          <ScreenTransform
            anchors={{
              left: -0.82,
              right: 0.82,
              top: -0.04 + Math.sin(elapsed * 6) * 0.012,
              bottom: -0.22 + Math.sin(elapsed * 6) * 0.012,
            }}
          >
            <TextLabel
              name="startPrompt"
              text="Show Peace Sign to Start Game"
              fontSize={120}
              color="#ffffff"
              bgColor="transparent"
              strokeColor="#2f1b0c"
              strokeWidth={10}
              shadowColor="#ffca3a"
              shadowBlur={18 + Math.sin(elapsed * 6) * 8}
              shadowOpacity={0.85}
              shadowOffsetY={4}
              glow={{
                color: "#ffca3a",
                style: "outward",
                intensity: 0.65,
                range: 18,
              }}
              aspect={6.8}
            />
          </ScreenTransform>
        )}

        {started && pregame && (
          <ScreenTransform
            anchors={{ left: -0.76, right: 0.76, top: -0.08, bottom: -0.25 }}
          >
            <TextLabel
              text="Move your head left and right"
              fontSize={110}
              color="#ffffff"
              bgColor="transparent"
              strokeColor="#2f1b0c"
              strokeWidth={9}
              shadowColor="#38bdf8"
              shadowBlur={16}
              aspect={6}
            />
          </ScreenTransform>
        )}

        {/* One literal TextLabel per step, so the console's visual editor can retype each. */}
        {countdownText === "3" && (
          <ScreenTransform
            anchors={{ left: -0.36, right: 0.36, top: 0.22, bottom: -0.18 }}
          >
            <TextLabel
              text="3"
              fontSize={300}
              color="#ffffff"
              bgColor="transparent"
              strokeColor="#2f1b0c"
              strokeWidth={16}
              shadowColor="#ffca3a"
              shadowBlur={24 + Math.sin(elapsed * 12) * 8}
              aspect={1.4}
            />
          </ScreenTransform>
        )}
        {countdownText === "2" && (
          <ScreenTransform
            anchors={{ left: -0.36, right: 0.36, top: 0.22, bottom: -0.18 }}
          >
            <TextLabel
              text="2"
              fontSize={300}
              color="#ffffff"
              bgColor="transparent"
              strokeColor="#2f1b0c"
              strokeWidth={16}
              shadowColor="#ffca3a"
              shadowBlur={24 + Math.sin(elapsed * 12) * 8}
              aspect={1.4}
            />
          </ScreenTransform>
        )}
        {countdownText === "1" && (
          <ScreenTransform
            anchors={{ left: -0.36, right: 0.36, top: 0.22, bottom: -0.18 }}
          >
            <TextLabel
              text="1"
              fontSize={300}
              color="#ffffff"
              bgColor="transparent"
              strokeColor="#2f1b0c"
              strokeWidth={16}
              shadowColor="#ffca3a"
              shadowBlur={24 + Math.sin(elapsed * 12) * 8}
              aspect={1.4}
            />
          </ScreenTransform>
        )}
        {countdownText === "GO!" && (
          <ScreenTransform
            anchors={{ left: -0.36, right: 0.36, top: 0.22, bottom: -0.18 }}
          >
            <TextLabel
              text="GO!"
              fontSize={230}
              color="#ffffff"
              bgColor="transparent"
              strokeColor="#2f1b0c"
              strokeWidth={16}
              shadowColor="#ffca3a"
              shadowBlur={24 + Math.sin(elapsed * 12) * 8}
              aspect={1.4}
            />
          </ScreenTransform>
        )}

        {readyForDrop && (
          <ScreenTransform
            anchors={{ left: -0.32, right: 0.32, top: 0.08, bottom: -0.06 }}
          >
            <TextLabel
              text="READY"
              fontSize={135}
              color="#ffffff"
              bgColor="transparent"
              strokeColor="#2f1b0c"
              strokeWidth={9}
              shadowColor="#ffca3a"
              shadowBlur={16 + Math.sin(elapsed * 8) * 5}
              aspect={3}
            />
          </ScreenTransform>
        )}

        {won && (
          <ScreenTransform
            anchors={{ left: -0.62, right: 0.62, top: 0.17, bottom: -0.03 }}
          >
            <TextLabel
              name="result"
              text="YOU WIN"
              fontSize={210}
              color="#ffffff"
              bgColor="rgba(31, 122, 55, 0.9)"
              borderRadius={26}
              aspect={4.4}
            />
          </ScreenTransform>
        )}

        {failed && (
          <ScreenTransform
            anchors={{ left: -0.62, right: 0.62, top: 0.17, bottom: -0.03 }}
          >
            <TextLabel
              name="result"
              text={`MISSED ${finalMissed}`}
              fontSize={210}
              color="#ffffff"
              bgColor="rgba(170, 45, 35, 0.9)"
              borderRadius={26}
              aspect={4.4}
            />
          </ScreenTransform>
        )}

        {(won || failed) && (
          <ScreenTransform
            anchors={{
              left: -0.82,
              right: 0.82,
              top: -0.12 + Math.sin(elapsed * 6) * 0.012,
              bottom: -0.3 + Math.sin(elapsed * 6) * 0.012,
            }}
          >
            <TextLabel
              name="resetPrompt"
              text="Show Peace Sign to Reset Game"
              fontSize={120}
              color="#ffffff"
              bgColor="transparent"
              strokeColor="#2f1b0c"
              strokeWidth={10}
              shadowColor="#ffca3a"
              shadowBlur={18 + Math.sin(elapsed * 6) * 8}
              shadowOpacity={0.85}
              shadowOffsetY={4}
              glow={{
                color: "#ffca3a",
                style: "outward",
                intensity: 0.65 + Math.sin(elapsed * 6) * 0.2,
                range: 18,
              }}
              aspect={6.8}
            />
          </ScreenTransform>
        )}
      </ScreenSpaceUI>
    </>
  );
};
