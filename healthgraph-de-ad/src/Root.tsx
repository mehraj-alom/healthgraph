import "./index.css";
import { Composition, Folder } from "remotion";
import { HealthGraphAd } from "./HealthGraphAd";
import { KineticHook } from "./KineticHook";
import { DataStreams } from "./DataStreams";
import { CountdownStress } from "./CountdownStress";
import { CalmDashboard } from "./CalmDashboard";
import { DURATION_IN_FRAMES, FPS, SCENES } from "./timing";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="HealthGraph-DE-Scenes">
        <Composition
          id="KineticHook"
          component={KineticHook}
          width={1920}
          height={1080}
          fps={30}
          durationInFrames={SCENES.hook.durationInFrames}
        />
        <Composition
          id="DataStreams"
          component={DataStreams}
          width={1920}
          height={1080}
          fps={30}
          durationInFrames={SCENES.streams.durationInFrames}
        />
        <Composition
          id="CountdownStress"
          component={CountdownStress}
          width={1920}
          height={1080}
          fps={30}
          durationInFrames={SCENES.countdown.durationInFrames}
        />
        <Composition
          id="CalmDashboard"
          component={CalmDashboard}
          width={1920}
          height={1080}
          fps={30}
          durationInFrames={SCENES.dashboard.durationInFrames}
        />
      </Folder>

      <Composition
        id="HealthGraphAd"
        component={HealthGraphAd}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={DURATION_IN_FRAMES}
      />
    </>
  );
};
