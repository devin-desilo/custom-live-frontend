import React, { useRef, useEffect, useState } from 'react';
import io from 'socket.io-client';
import Hls from 'hls.js';

// Create socket connection with authentication
const createSocket = (roomId) => {
  // Generate a temporary token for authentication
  const token = `temp_${Math.random().toString(36).substring(2, 15)}`;
  
  return io('http://localhost:5000', {
    query: { token },
    auth: { token },
    autoConnect: false
  });
};

function Broadcaster({ roomId }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [streamSource, setStreamSource] = useState('webcam'); // webcam or obs
  const [availableCameras, setAvailableCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const hlsStreamUrl = `http://localhost:8080/hls/stream_${roomId}.m3u8`;
  const webrtcStreamUrl = `http://localhost:8000/webrtc/stream_${roomId}`;
  const socketRef = useRef(null);

  // Initialize socket connection when component mounts
  useEffect(() => {
    socketRef.current = createSocket(roomId);
    
    // Connect socket when component mounts
    socketRef.current.connect();
    console.log('Broadcaster socket connected:', socketRef.current.id);
    
    // Join the room
    socketRef.current.emit('join-room', { roomId, userId: socketRef.current.id });
    console.log('Broadcaster joined room:', roomId);
    
    // Clean up socket connection when component unmounts
    return () => {
      if (socketRef.current) {
        console.log('Broadcaster cleaning up socket connection');
        socketRef.current.disconnect();
      }
    };
  }, [roomId]);

  useEffect(() => {
    // Get list of available cameras
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
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hls.loadSource(hlsStreamUrl);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current.play();
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log('Network error in host preview, retrying...');
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log('Media error in host preview, recovering...');
                hls.recoverMediaError();
                break;
              default:
                console.log('Unrecoverable error in host preview', data);
                hls.destroy();
                break;
            }
          }
        });
        return () => {
          hls.destroy();
        };
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        videoRef.current.src = hlsStreamUrl;
        videoRef.current.addEventListener('loadedmetadata', () => {
          videoRef.current.play();
        });
        return () => {
          videoRef.current.removeEventListener('loadedmetadata', () => {});
        };
      } else {
        console.error('HLS not supported on this browser for host preview');
      }
    }
  }, [isStreaming, streamSource, hlsStreamUrl]);

  const startStreaming = async () => {
    if (streamSource === 'webcam') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            deviceId: selectedCamera ? { exact: selectedCamera } : undefined 
          }, 
          audio: true 
        });
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsStreaming(true);
        console.log('Streaming from webcam');
        
        // Notify server about webcam streaming
        console.log('Emitting start_streaming event for webcam');
        socketRef.current.emit('start_streaming', { roomId, source: 'webcam' });
        
        // Start WebRTC connection to send stream to server
        startWebRTCStream(stream);
      } catch (err) {
        console.error('Error accessing media devices:', err);
      }
    } else if (streamSource === 'obs') {
      setIsStreaming(true);
      console.log('Streaming from OBS');
      
      // Notify server about OBS streaming
      console.log('Emitting start_streaming event for OBS');
      socketRef.current.emit('start_streaming', { roomId, source: 'obs' });
      
      // For OBS, we need to show the preview from the HLS stream
      if (videoRef.current) {
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
          });
          hls.loadSource(hlsStreamUrl);
          hls.attachMedia(videoRef.current);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            videoRef.current.play();
          });
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log('Network error in host preview, retrying...');
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log('Media error in host preview, recovering...');
                  hls.recoverMediaError();
                  break;
                default:
                  console.log('Unrecoverable error in host preview', data);
                  hls.destroy();
                  break;
              }
            }
          });
        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          videoRef.current.src = hlsStreamUrl;
          videoRef.current.addEventListener('loadedmetadata', () => {
            videoRef.current.play();
          });
        } else {
          console.error('HLS not supported on this browser for host preview');
        }
      }
    }
  };

  const startWebRTCStream = (stream) => {
    // WebRTC configuration - adjust ICE servers as needed
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
    peerConnectionRef.current = new RTCPeerConnection(configuration);

    // Add stream tracks to peer connection
    stream.getTracks().forEach(track => {
      peerConnectionRef.current.addTrack(track, stream);
    });

    // Handle ICE candidates and send to server
    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to server:', event.candidate);
        socketRef.current.emit('webrtc_ice_candidate', { 
          roomId,
          candidate: event.candidate 
        });
      }
    };

    // Create an offer and send to server
    peerConnectionRef.current.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    }).then(offer => {
      return peerConnectionRef.current.setLocalDescription(offer);
    }).then(() => {
      console.log('Sending WebRTC offer to server:', peerConnectionRef.current.localDescription);
      socketRef.current.emit('webrtc_offer', { 
        roomId,
        sdp: peerConnectionRef.current.localDescription 
      });
    }).catch(err => {
      console.error('Error creating WebRTC offer:', err);
    });

    // Listen for answer from server
    socketRef.current.on('webrtc_answer', (data) => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp))
          .then(() => console.log('Remote description set with answer from server'))
          .catch(err => console.error('Error setting remote description:', err));
      }
    });

    // Listen for ICE candidates from server
    socketRef.current.on('webrtc_ice_candidate', (data) => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate))
          .then(() => console.log('ICE candidate added from server'))
          .catch(err => console.error('Error adding ICE candidate:', err));
      }
    });
  };

  const stopStreaming = async () => {
    try {
      // First, stop the media tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
        streamRef.current = null;
      }
      
      // Close WebRTC connection if it exists
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      // Update UI state
      setIsStreaming(false);
      
      // Notify server that streaming has stopped
      console.log('Emitting stop_streaming event');
      socketRef.current.emit('stop_streaming', roomId);
      
      // Call API to delete room first
      try {
        const response = await fetch('http://localhost:5000/delete-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId }),
        });
        
        if (response.ok) {
          console.log(`Room ${roomId} deleted successfully.`);
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
        audio: true
      });
      // Stop current tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      videoRef.current.play();
      setSelectedCamera(deviceId);
      // Update WebRTC stream
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
        streamRef.current = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
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
        {
          isStreaming ? (
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
          )
        }
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
              <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${camera.deviceId}`}</option>
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
            <p><strong>RTMP Server:</strong> rtmp://localhost:1935/live</p>
            <p><strong>Stream Key:</strong> stream_{roomId}</p>
            <p className="text-xs text-gray-500 mt-1">Configure OBS with the above RTMP server and stream key to push your stream. Use OBS to capture your webcam or other sources.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Broadcaster; 