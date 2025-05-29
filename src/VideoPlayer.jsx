import React, { useRef, useEffect } from "react";
import Hls from "hls.js";

const VideoPlayer = ({ streamUrl }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play();
      });
      hls.on(Hls.Events.ERROR, function (event, data) {
        console.error("💥 HLS.js error:", data.type, data.details, data);
      });

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.addEventListener("loadedmetadata", () => {
        video.play();
      });
    } else {
      console.error("This browser doesn't support HLS.");
    }
  }, [streamUrl]);

  return (
    <video
      ref={videoRef}
      controls
      autoPlay
      muted
      style={{ width: "100%", maxWidth: "600px" }}
    />
  );
};

export default VideoPlayer;
