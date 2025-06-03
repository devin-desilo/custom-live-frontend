// VideoPlayer.jsx
import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import io from 'socket.io-client';

const createSocket = (roomId) => {
  const token = `temp_${Math.random().toString(36).substring(2, 15)}`;
  console.log('Creating socket with token:', token);
  const socket = io('http://localhost:5000', {
    query: { token, roomId },
    auth: { token },
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => console.log('Socket connected successfully'));
  socket.on('connect_error', (error) => console.error('Socket connection error:', error));
  socket.on('disconnect', (reason) => console.log('Socket disconnected:', reason));
  socket.on('error', (error) => console.error('Socket error:', error));

  return socket;
};

function VideoPlayer({ streamUrl }) {
  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const hlsRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const playPromiseRef = useRef(null);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [streamSource, setStreamSource] = useState(null);
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(true);

  const roomId = streamUrl ? streamUrl.split('stream_')[1]?.split('.')[0] : null;
  const hlsStreamUrl = `http://localhost:8020/live/stream_${roomId}/index.m3u8`;

  const safePlay = async (video) => {
    try {
      if (playPromiseRef.current) {
        console.log('Waiting for pending play request to complete');
        await playPromiseRef.current;
        playPromiseRef.current = null;
      }

      console.log('=== Attempting Video Playback ===');
      console.log('Video state:', {
        readyState: video.readyState,
        paused: video.paused,
        currentTime: video.currentTime,
        duration: video.duration,
        networkState: video.networkState,
        error: video.error,
        srcObject: !!video.srcObject,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      });

      if (video.readyState >= 2 || video.srcObject) {
        video.muted = false;
        try {
          playPromiseRef.current = video.play();
          await playPromiseRef.current;
          console.log('Video playback started successfully');
          setIsStreamActive(true);
          setError(null);
          setIsConnecting(false);
        } catch (playError) {
          console.error('Error playing video:', playError);
          if (playError.name === 'AbortError') {
            console.log('Play request was interrupted, retrying...');
            playPromiseRef.current = null;
            setTimeout(() => safePlay(video), 100);
          } else {
            setError('Error playing video: ' + playError.message);
            setIsConnecting(false);
          }
        }
      } else {
        console.log('Video not ready, retrying...');
        video.load();
        setTimeout(() => safePlay(video), 500);
      }
    } catch (err) {
      console.error('Error in safePlay:', err);
      setError('Error playing video: ' + err.message);
      playPromiseRef.current = null;
      setIsConnecting(false);
    }
  };

  const loadHLSStream = () => {
    if (!videoRef.current) return;
    console.log('Loading HLS stream:', hlsStreamUrl);
    
    const checkStreamAvailability = async () => {
      try {
        const response = await fetch(hlsStreamUrl);
        if (response.ok) {
          console.log('HLS stream is available');
          if (Hls.isSupported()) {
            if (hlsRef.current) {
              hlsRef.current.destroy();
            }
            hlsRef.current = new Hls({ 
              lowLatencyMode: true,
              enableWorker: true,
              debug: true,
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
              maxBufferSize: 60 * 1000 * 1000,
              maxBufferHole: 0.5,
              backBufferLength: 90
            });
            
            hlsRef.current.loadSource(hlsStreamUrl);
            hlsRef.current.attachMedia(videoRef.current);
            
            hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
              console.log('HLS manifest parsed');
              if (videoRef.current.readyState >= 2) {
                safePlay(videoRef.current);
              } else {
                console.log('Video element not ready yet, waiting for canplay event');
                videoRef.current.addEventListener('canplay', () => {
                  console.log('Video element can play now');
                  safePlay(videoRef.current);
                }, { once: true });
              }
            });
            
            hlsRef.current.on(Hls.Events.ERROR, (event, data) => {
              console.error('HLS error:', data);
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('Network error, trying to recover...');
                    hlsRef.current.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('Media error, trying to recover...');
                    hlsRef.current.recoverMediaError();
                    break;
                  default:
                    console.log('Fatal error, destroying HLS instance');
                    hlsRef.current.destroy();
                    setError('Stream error occurred');
                    setTimeout(checkStreamAvailability, 2000); // Retry after error
                    break;
                }
              }
            });
          } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
            videoRef.current.src = hlsStreamUrl;
            videoRef.current.addEventListener('canplay', () => {
              console.log('Video element can play now (native HLS)');
              safePlay(videoRef.current);
            }, { once: true });
          } else {
            setError('HLS not supported');
          }
        } else {
          console.log('HLS stream not yet available, retrying in 2 seconds...');
          setTimeout(checkStreamAvailability, 2000);
        }
      } catch (err) {
        console.log('Error checking HLS stream:', err);
        setTimeout(checkStreamAvailability, 2000);
      }
    };

    checkStreamAvailability();
  };

  useEffect(() => {
    if (!roomId) {
      console.error('No roomId found in streamUrl:', streamUrl);
      setError('Invalid room ID');
      setIsConnecting(false);
      return;
    }

    console.log('=== Viewer Connection Process Started ===');
    socketRef.current = createSocket(roomId);
    socketRef.current.connect();

    socketRef.current.on('connect', () => {
      console.log('Socket connected, ID:', socketRef.current.id);
      
      // First check room status
      fetch(`http://localhost:5000/room/${roomId}`)
        .then(response => response.json())
        .then(roomData => {
          console.log('Room status:', roomData);
          
          if (!roomData.isStreamActive) {
            setError('Stream is not active yet');
            setIsConnecting(false);
            return;
          }

          // If stream is active, proceed with joining
          socketRef.current.emit('join-room', { roomId, userId: socketRef.current.id }, (response) => {
            console.log('Join room response:', response);
            if (!response.success) {
              setError(response.error || 'Failed to join room');
              setIsConnecting(false);
              return;
            }

            setIsStreamActive(response.isStreamActive);
            setStreamSource(response.streamSource);

            if (response.isStreamActive) {
              if (response.streamSource === 'webcam' && response.offer) {
                console.log('Initializing WebRTC with stored offer');
                handleWebRTCOffer(response.offer);
              } else if (response.streamSource === 'obs') {
                console.log('Loading HLS stream for OBS');
                loadHLSStream();
              }
            }
          });
        })
        .catch(error => {
          console.error('Error checking room status:', error);
          setError('Failed to check room status');
          setIsConnecting(false);
        });
    });

    socketRef.current.on('stream_started', (data) => {
      console.log('Stream started:', data);
      setIsStreamActive(true);
      setStreamSource(data.source);
      setError(null);
      setIsConnecting(true);
      if (data.source === 'obs') {
        loadHLSStream();
      } else if (data.source === 'webcam') {
        initializeWebRTC();
      }
    });

    socketRef.current.on('stream_ended', (data) => {
      console.log('Stream ended:', data);
      setIsStreamActive(false);
      setStreamSource(null);
      setError('Stream has ended');
      setIsConnecting(false);
      pendingCandidatesRef.current = [];
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    });

    socketRef.current.on('webrtc_offer', (data) => {
      console.log('Received WebRTC offer:', data);
      handleWebRTCOffer(data);
    });

    socketRef.current.on('webrtc_ice_candidate', (data) => {
      console.log('Received ICE candidate:', data);
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate))
          .then(() => console.log('ICE candidate added'))
          .catch(err => console.error('Error adding ICE candidate:', err));
      } else {
        pendingCandidatesRef.current.push(data.candidate);
      }
    });

    const handleWebRTCOffer = (data) => {
      console.log('Processing WebRTC offer:', data);
      initializeWebRTC();

      const sdp = data.sdp || data;
      peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(sdp))
        .then(() => peerConnectionRef.current.createAnswer())
        .then(answer => peerConnectionRef.current.setLocalDescription(answer))
        .then(() => {
          socketRef.current.emit('webrtc_answer', {
            roomId,
            sdp: peerConnectionRef.current.localDescription,
            broadcasterId: data.broadcasterId || socketRef.current.id,
          });
          pendingCandidatesRef.current.forEach(candidate => {
            peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
              .then(() => console.log('Pending ICE candidate added'))
              .catch(err => console.error('Error adding pending ICE candidate:', err));
          });
          pendingCandidatesRef.current = [];
        })
        .catch(err => {
          console.error('Error handling WebRTC offer:', err);
          setError('Failed to process WebRTC offer');
          setIsConnecting(false);
        });
    };

    const initializeWebRTC = () => {
      console.log('Initializing WebRTC');
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      peerConnectionRef.current = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      peerConnectionRef.current.ontrack = (event) => {
        console.log('Received track:', event.track);
        if (videoRef.current && event.streams[0]) {
          // Stop any existing tracks only if we're setting a new stream
          if (videoRef.current.srcObject && videoRef.current.srcObject !== event.streams[0]) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
          }
          // Only set srcObject if it's not already set to this stream
          if (videoRef.current.srcObject !== event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            console.log('Stream set to video element:', event.streams[0].getTracks());
            safePlay(videoRef.current);
          } else {
            console.log('Stream already set to video element, skipping reset');
          }
        }
      };

      peerConnectionRef.current.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current.emit('webrtc_ice_candidate', {
            roomId,
            candidate: event.candidate,
            senderId: socketRef.current.id,
          });
        }
      };

      peerConnectionRef.current.onconnectionstatechange = () => {
        console.log('WebRTC connection state:', peerConnectionRef.current.connectionState);
        if (peerConnectionRef.current.connectionState === 'failed') {
          setError('WebRTC connection failed');
          setIsConnecting(false);
        }
      };
    };

    return () => {
      socketRef.current.disconnect();
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, [roomId, streamUrl]);

  return (
    <div className="mt-4 w-full max-w-md">
      <h2 className="text-xl font-bold mb-2">Live Stream</h2>
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <strong>Error: </strong>
          <span>{error}</span>
        </div>
      )}
      {isConnecting && !error && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4">
          <strong>Connecting: </strong>
          <span>Establishing connection to stream...</span>
        </div>
      )}
      {!isStreamActive && !error && !isConnecting && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4">
          <strong>Waiting: </strong>
          <span>Stream is not active yet</span>
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        controls
        className="w-full h-48 bg-black rounded-lg"
      />
      <p className="text-sm text-gray-600 mt-2">
        {isStreamActive ? `Watching: ${streamSource === 'webcam' ? 'WebRTC Stream' : 'HLS Stream'}` : 
         isConnecting ? 'Connecting...' : 'Waiting for stream...'}
      </p>
    </div>
  );
}

export default VideoPlayer;