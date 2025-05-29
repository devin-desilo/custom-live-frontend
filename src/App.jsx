import React from 'react';
import VideoPlayer from './VideoPlayer';


function App() {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center">
    <h1 className="text-3xl font-bold mb-4">Live Stream Viewer</h1>
    <VideoPlayer streamUrl="http://localhost:8080/hls/stream.m3u8" />
    </div>
    );   
}

export default App;
