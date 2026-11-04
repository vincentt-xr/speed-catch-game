/* eslint-disable react/no-unknown-property */
import { useEffect, useMemo, useState } from "react";
import { PerspectiveCamera } from "@react-three/drei";
import {
  createDefaultComponent,
  createOrderedComponentsSelector,
  createSceneObject,
  createRenderPlan,
  migrateToRenderGroups,
  type RenderGroupSceneObjectStore,
  type SceneComponent,
  type SceneObject,
  type SceneObjectId,
  type SceneObjectStore,
} from "@vincentt-xr/sdk/scene-object";
import {
  EXTERNAL_BACKGROUND_RENDER_LAYER,
  getRenderGroupLayer,
  RenderGroupLayer,
  SceneObjectRenderer,
  SequentialRenderPasses,
  XRScene,
  VideoBackground,
} from "@vincentt-xr/sdk";

import { PreviewAnchors } from "./PreviewAnchors";

type EditorSceneStore = RenderGroupSceneObjectStore & {
  selectedObjectId: SceneObjectId;
};

type HudSceneEditorProps = {
  loadingComponent: React.ReactNode;
  errorComponent: React.ReactNode;
  canvasProps?: React.ComponentProps<typeof XRScene>["canvasProps"];
  mediaSourceBinder: React.ReactNode;
  gameScene: React.ReactNode;
  timeText: string;
  caughtText: string;
};

const selectOrderedComponents = createOrderedComponentsSelector();

const createInitialScene = (): EditorSceneStore => {
  const timeObject = createSceneObject({
    name: "Time Text",
    renderGroupId: "2d-foreground",
  });
  const timeTransform = createDefaultComponent("ScreenTransform", timeObject.id);
  const timeText = createDefaultComponent("ScreenText", timeObject.id);
  timeTransform.settings.position = { x: 7.5, y: -16 };
  timeTransform.settings.size = { width: 680, height: 1230 };
  timeTransform.settings.referencePixelsPerUnit = 32;
  timeTransform.settings.renderOrder = 999;
  timeTransform.settings.overlay = true;
  timeTransform.settings.visible = true;
  timeText.settings.content.text = "Time : 0 sec";
  timeText.settings.layout.textAlign = "left";
  timeText.settings.layout.verticalAlign = "top";
  timeText.settings.style.fontSize = 36;
  timeText.settings.style.fontFamily = "\"Space Grotesk\", sans-serif";
  timeText.settings.style.fontWeight = 400;
  timeText.settings.style.color = "#fef3c7";
  timeText.settings.style.aspect = 10;
  timeText.settings.style.outlineEnabled = true;
  timeText.settings.style.strokeLayers = [
    { color: "#0f172a", width: 12, opacity: 1 },
  ];
  timeText.settings.transformation.coordinateSpace = "canvas";
  timeText.settings.transformation.canvasSize = { width: 720, height: 1280 };
  timeText.settings.transformation.position = { x: 7.5, y: -16 };
  timeText.settings.transformation.size = { width: 680, height: 1230 };
  timeText.settings.transformation.renderOrder = 999;
  timeText.settings.screenTransform = {
    ...timeText.settings.screenTransform,
    ...timeTransform.settings,
  };
  timeObject.componentIds = [timeTransform.id, timeText.id];

  const caughtObject = createSceneObject({
    name: "Caught Text",
    renderGroupId: "2d-foreground",
  });
  const caughtTransform = createDefaultComponent(
    "ScreenTransform",
    caughtObject.id,
  );
  const caughtText = createDefaultComponent("ScreenText", caughtObject.id);
  caughtTransform.settings.position = { x: -10, y: -17.5 };
  caughtTransform.settings.size = { width: 680, height: 1230 };
  caughtTransform.settings.referencePixelsPerUnit = 32;
  caughtTransform.settings.renderOrder = 999;
  caughtTransform.settings.overlay = true;
  caughtTransform.settings.visible = true;
  caughtText.settings.content.text = "Caught : 0 / 8";
  caughtText.settings.layout.textAlign = "right";
  caughtText.settings.layout.verticalAlign = "top";
  caughtText.settings.style.fontSize = 36;
  caughtText.settings.style.fontFamily = "\"Space Grotesk\", sans-serif";
  caughtText.settings.style.fontWeight = 400;
  caughtText.settings.style.color = "#d1fae5";
  caughtText.settings.style.aspect = 10;
  caughtText.settings.style.outlineEnabled = true;
  caughtText.settings.style.strokeLayers = [
    { color: "#0f172a", width: 12, opacity: 1 },
  ];
  caughtText.settings.transformation.coordinateSpace = "canvas";
  caughtText.settings.transformation.canvasSize = { width: 720, height: 1280 };
  caughtText.settings.transformation.position = { x: -10, y: -17.5 };
  caughtText.settings.transformation.size = { width: 680, height: 1230 };
  caughtText.settings.transformation.renderOrder = 999;
  caughtText.settings.screenTransform = {
    ...caughtText.settings.screenTransform,
    ...caughtTransform.settings,
  };
  caughtObject.componentIds = [caughtTransform.id, caughtText.id];

  return migrateToRenderGroups(
    {
      selectedObjectId: timeObject.id,
      objects: {
        [timeObject.id]: timeObject,
        [caughtObject.id]: caughtObject,
      },
      components: {
        [timeTransform.id]: timeTransform,
        [timeText.id]: timeText,
        [caughtTransform.id]: caughtTransform,
        [caughtText.id]: caughtText,
      },
    } satisfies SceneObjectStore & { selectedObjectId: SceneObjectId },
    [timeObject.id, caughtObject.id],
  );
};

export const HudSceneEditor = ({
  loadingComponent,
  errorComponent,
  canvasProps,
  mediaSourceBinder,
  gameScene,
  timeText,
  caughtText,
}: HudSceneEditorProps) => {
  const [scene, setScene] = useState<EditorSceneStore>(createInitialScene);

  useEffect(() => {
    setScene((current: EditorSceneStore) => {
      const [timeObject, caughtObject] = Object.values(current.objects) as SceneObject[];
      if (!timeObject || !caughtObject) return current;
      const next = structuredClone(current) as EditorSceneStore;
      const timeComponent = selectOrderedComponents(next, timeObject.id).find(
        (component: SceneComponent) => component.type === "ScreenText",
      );
      const caughtComponent = selectOrderedComponents(next, caughtObject.id).find(
        (component: SceneComponent) => component.type === "ScreenText",
      );
      if (timeComponent?.type === "ScreenText") {
        timeComponent.settings.content.text = timeText;
      }
      if (caughtComponent?.type === "ScreenText") {
        caughtComponent.settings.content.text = caughtText;
      }
      return next;
    });
  }, [timeText, caughtText]);

  const renderPlan = useMemo(() => createRenderPlan(scene), [scene]);
  const renderPassLayers = useMemo(
    () => [
      EXTERNAL_BACKGROUND_RENDER_LAYER,
      ...scene.renderGroupOrder.flatMap((groupId: string, groupIndex: number) => {
        const group = scene.renderGroups[groupId];
        const hasRenderableObject = group?.objectIds.some(
          (objectId: string) => scene.objects[objectId]?.enabled,
        );
        return group?.enabled && hasRenderableObject
          ? [getRenderGroupLayer(groupIndex)]
          : [];
      }),
    ],
    [scene],
  );

  const replaceComponent = (component: SceneComponent) => {
    setScene((current: EditorSceneStore) => ({
      ...current,
      components: { ...current.components, [component.id]: component },
    }));
  };

  return (
      <XRScene
        loadingComponent={loadingComponent}
        errorComponent={errorComponent}
        loadingTransitionDuration={1000}
        style={{ width: "100%", height: "100%" }}
        canvasProps={canvasProps}
      >
        {mediaSourceBinder}
        <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={45} />
        <SequentialRenderPasses layers={renderPassLayers} />
        <RenderGroupLayer layer={EXTERNAL_BACKGROUND_RENDER_LAYER}>
          <VideoBackground customBackground="#6366f1" renderOrder={-999} />
        </RenderGroupLayer>
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 4, 5]} intensity={1.3} />
        {gameScene}
        {renderPlan.map((entry) => (
          <SceneObjectRenderer
            key={entry.objectId}
            objectId={entry.objectId}
            store={scene}
            renderOrder={entry.renderOrder}
            renderLayer={entry.renderLayer}
            editorMode={false}
            onComponentChange={replaceComponent}
          />
        ))}
        <PreviewAnchors />
      </XRScene>
  );
};
