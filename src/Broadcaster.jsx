import React, { useRef, useEffect, useState } from 'react';
import io from 'socket.io-client';
import Hls from 'hls.js';

const createSocket = (roomId) => {
  const token = `temp_${Math.random().toString(36).substring(2, 15)}`;
  return io('http://localhost:5000', {
    query: { token },
    auth: { token },
    autoConnect: false,
  });
};

function Broadcaster({ roomId }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [streamSource, setStreamSource] = useState('webcam');
  const [availableCameras, setAvailableCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const hlsStreamUrl = `http://localhost:8080/hls/stream_${roomId}.m3u8`;
  const socketRef = useRef(null);

  useEffect(() => {
    socketRef.current = createSocket(roomId);
    socketRef.current.connect();
    console.log('Broadcaster socket connected:', socketRef.current.id);
    socketRef.current.emit('join-room', { roomId, userId: socketRef.current.id });
    console.log('Broadcaster joined room:', roomId);

    return () => {
      if (socketRef.current) {
        console.log('Broadcaster cleaning up socket');
        socketRef.current.disconnect();
      }
    };
  }, [roomId]);

  useEffect(() => {
    const getCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(device => device.kind === 'videoinput');
        setAvailableCameras(cameras);
        if (cameras.length > 0) {
          setSelectedCamera(cameras[0].deviceId);
        }
      } catch (err) {
        console.error('Error enumerating devices:', err);
      }
    };
    getCameras();
  }, []);

  useEffect(() => {
    if (isStreaming && streamSource === 'obs' && videoRef.current) {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hls.loadSource(hlsStreamUrl);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current.play();
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.error('HLS error in host preview:', data);
            hls.destroy();
          }
        });
        return () => hls.destroy();
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        videoRef.current.src = hlsStreamUrl;
        videoRef.current.play();
      } else {
        console.error('HLS not supported for host preview');
      }
    }
  }, [isStreaming, streamSource, hlsStreamUrl]);

  const startStreaming = async () => {
    if (streamSource === 'webcam') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: selectedCamera ? { exact: selectedCamera } : undefined },
          audio: true,
        });
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsStreaming(true);
        console.log('Streaming webcam, tracks:', stream.getTracks().map(t => t.kind));
        socketRef.current.emit('start_streaming', { roomId, source: 'webcam' });
        startWebRTCStream(stream);
      } catch (err) {
        console.error('Error accessing media devices:', err);
      }
    } else if (streamSource === 'obs') {
      setIsStreaming(true);
      console.log('Streaming OBS');
      socketRef.current.emit('start_streaming', { roomId, source: 'obs' });
    }
  };

  const startWebRTCStream = (stream) => {
    console.log('Starting WebRTC, tracks:', stream.getTracks());
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Add TURN server for non-local testing
        // { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' }
      ],
    };
    peerConnectionRef.current = new RTCPeerConnection(configuration);
    console.log('PeerConnection created, signalingState:', peerConnectionRef.current.signalingState);

    stream.getTracks().forEach(track => {
      console.log('Adding track:', track.kind, 'enabled:', track.enabled);
      peerConnectionRef.current.addTrack(track, stream);
    });

    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate:', event.candidate);
        socketRef.current.emit('webrtc_ice_candidate', { roomId, candidate: event.candidate });
      } else {
        console.log('ICE candidate gathering complete');
      }
    };

    peerConnectionRef.current.onconnectionstatechange = () => {
      console.log('connectionState:', peerConnectionRef.current.connectionState);
    };

    peerConnectionRef.current.oniceconnectionstatechange = () => {
      console.log('iceConnectionState:', peerConnectionRef.current.iceConnectionState);
      console.log('iceGatheringState:', peerConnectionRef.current.iceGatheringState);
    };

    peerConnectionRef.current.onsignalingstatechange = () => {
      console.log('signalingState:', peerConnectionRef.current.signalingState);
    };

    peerConnectionRef.current.ontrack = (event) => {
      console.warn('Host received track (unexpected):', event.track.kind);
    };

    peerConnectionRef.current.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    })
      .then(offer => {
        console.log('Offer created:', offer.sdp.substring(0, 100) + '...');
        return peerConnectionRef.current.setLocalDescription(offer);
      })
      .then(() => {
        console.log('Local description set, sending webrtc_offer');
        socketRef.current.emit('webrtc_offer', {
          roomId,
          sdp: peerConnectionRef.current.localDescription,
        });
      })
      .catch(err => console.error('Error creating offer:', err));

    socketRef.current.on('webrtc_answer', (data) => {
      console.log('Received webrtc_answer:', data);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp))
          .then(() => {
            console.log('Remote description set, signalingState:', peerConnectionRef.current.signalingState);
          })
          .catch(err => console.error('Error setting remote description:', err));
      }
    });

    socketRef.current.on('webrtc_ice_candidate', (data) => {
      console.log('Received ICE candidate:', data);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate))
          .then(() => console.log('ICE candidate added'))
          .catch(err => console.error('Error adding ICE candidate:', err));
      }
    });
  };

  const stopStreaming = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
        streamRef.current = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      setIsStreaming(false);
      console.log('Emitting stop_streaming');
      socketRef.current.emit('stop_streaming', roomId);

      try {
        const response = await fetch('http://localhost:5000/delete-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId }),
        });
        if (response.ok) {
          console.log(`Room ${roomId} deleted`);
        } else {
          console.error('Failed to delete room:', await response.text());
        }
      } catch (err) {
        console.error('Error deleting room:', err);
      }
    } catch (err) {
      console.error('Error stopping stream:', err);
    }
  };

  const toggleAudio = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isAudioEnabled;
      });
      setIsAudioEnabled(!isAudioEnabled);
    }
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !isVideoEnabled;
      });
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  const switchCamera = async (deviceId) => {
    if (!isStreaming || streamSource !== 'webcam') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
        audio: true,
      });
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      videoRef.current.play();
      setSelectedCamera(deviceId);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.getSenders().forEach(sender => {
          if (sender.track.kind === 'video') {
            sender.replaceTrack(stream.getVideoTracks()[0]);
          }
        });
      }
    } catch (err) {
      console.error('Error switching camera:', err);
    }
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      socketRef.current.off('webrtc_answer');
      socketRef.current.off('webrtc_ice_candidate');
    };
  }, []);

  return (
    <div className="mt-4 w-full max-w-md">
      <h2 className="text-xl font-bold mb-2">Broadcaster</h2>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-48 bg-black rounded-lg mb-4"
      />
      <div className="flex space-x-2 mb-4">
        {isStreaming ? (
          <button
            onClick={stopStreaming}
            disabled={!isStreaming}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 disabled:bg-gray-400"
          >
            Stop Streaming
          </button>
        ) : (
          <button
            onClick={startStreaming}
            disabled={isStreaming}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
          >
            Start Streaming
          </button>
        )}
        <button
          onClick={toggleAudio}
          className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
        >
          {isAudioEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button
          onClick={toggleVideo}
          className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
        >
          {isVideoEnabled ? 'Hide' : 'Show'}
        </button>
      </div>
      {streamSource === 'webcam' && availableCameras.length > 1 && (
        <div className="mt-2">
          <label className="block text-gray-700 text-sm font-bold mb-2">Select Camera</label>
          <select
            value={selectedCamera}
            onChange={(e) => switchCamera(e.target.value)}
            className="shadow border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            disabled={isStreaming}
          >
            {availableCameras.map(camera => (
              <option key={camera.deviceId} value={camera.deviceId}>
                {camera.label || `Camera ${camera.deviceId}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="mt-2">
        <label className="block text-gray-700 text-sm font-bold mb-2">Stream Source</label>
        <select
          value={streamSource}
          onChange={(e) => setStreamSource(e.target.value)}
          className="shadow border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
          disabled={isStreaming}
        >
          <option value="webcam">Webcam (WebRTC)</option>
          <option value="obs">OBS (RTMP)</option>
        </select>
        {streamSource === 'obs' && (
          <div className="mt-2 text-sm text-gray-700">
            <p>
              <strong>RTMP Server:</strong> rtmp://localhost:1935/live
            </p>
            <p>
              <strong>Stream Key:</strong> stream_{roomId}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Configure OBS with the above RTMP server and stream key to push your stream.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Broadcaster;