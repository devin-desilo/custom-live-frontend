import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import io from 'socket.io-client';

const createSocket = (roomId) => {
  const token = `temp_${Math.random().toString(36).substring(2, 15)}`;
  return io('http://localhost:5000', {
    query: { token },
    auth: { token },
    autoConnect: false,
  });
};

function VideoPlayer({ streamUrl }) {
  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const hlsRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [streamSource, setStreamSource] = useState(null);
  const [error, setError] = useState(null);
  const [pendingCandidates, setPendingCandidates] = useState([]);

  const roomId = streamUrl ? streamUrl.split('stream_')[1]?.split('.')[0] : null;
  const hlsStreamUrl = `http://localhost:8080/hls/stream_${roomId}.m3u8`;

  useEffect(() => {
    if (!roomId) {
      console.error('No roomId found in streamUrl:', streamUrl);
      setError('Invalid room ID');
      return;
    }

    console.log('Initializing VideoPlayer for room:', roomId);
    socketRef.current = createSocket(roomId);

    socketRef.current.on('connect', () => {
      console.log('Socket connected, ID:', socketRef.current.id);
      socketRef.current.emit('join-room', { roomId, userId: socketRef.current.id }, (response) => {
        console.log('Join room response:', response);
        if (response?.isStreamActive) {
          console.log('Stream active on join, source:', response.streamSource);
          setIsStreamActive(true);
          setStreamSource(response.streamSource);
          if (response.streamSource === 'webcam') {
            initializeWebRTC();
          } else if (response.streamSource === 'obs') {
            loadHLSStream();
          }
        }
      });
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('Socket connect error:', error);
      setError('Failed to connect to server');
    });

    socketRef.current.on('stream_started', (data) => {
      console.log('Stream started:', data);
      setIsStreamActive(true);
      setStreamSource(data.source);
      setError(null);
      if (data.source === 'webcam') {
        initializeWebRTC();
      } else if (data.source === 'obs') {
        loadHLSStream();
      }
    });

    socketRef.current.on('stream_ended', (data) => {
      console.log('Stream ended:', data);
      setIsStreamActive(false);
      setStreamSource(null);
      setPendingCandidates([]);
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
      console.log('Received webrtc_offer:', data);
      if (!peerConnectionRef.current) {
        console.log('No peer connection, initializing WebRTC');
        initializeWebRTC();
      }
      peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(() => {
          console.log('Remote description set, signalingState:', peerConnectionRef.current.signalingState);
          return peerConnectionRef.current.createAnswer();
        })
        .then(answer => {
          console.log('Answer created');
          return peerConnectionRef.current.setLocalDescription(answer);
        })
        .then(() => {
          console.log('Sending webrtc_answer, localDescription:', peerConnectionRef.current.localDescription);
          socketRef.current.emit('webrtc_answer', {
            roomId,
            sdp: peerConnectionRef.current.localDescription,
            broadcasterId: data.broadcasterId,
          });
          // Apply pending ICE candidates
          pendingCandidates.forEach(candidate => {
            console.log('Applying pending ICE candidate:', candidate);
            peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
              .catch(err => console.error('Error applying pending ICE candidate:', err));
          });
          setPendingCandidates([]);
        })
        .catch(err => {
          console.error('Error handling webrtc_offer:', err);
          setError('Failed to process WebRTC offer');
        });
    });

    socketRef.current.on('webrtc_ice_candidate', (data) => {
      console.log('Received webrtc_ice_candidate:', data);
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate))
          .then(() => console.log('ICE candidate added'))
          .catch(err => console.error('Error adding ICE candidate:', err));
      } else {
        console.log('Storing ICE candidate, peerConnection not ready');
        setPendingCandidates(prev => [...prev, data.candidate]);
      }
    });

    socketRef.current.connect();

    return () => {
      socketRef.current.off('connect');
      socketRef.current.off('connect_error');
      socketRef.current.off('stream_started');
      socketRef.current.off('stream_ended');
      socketRef.current.off('webrtc_offer');
      socketRef.current.off('webrtc_ice_candidate');
      socketRef.current.disconnect();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    };
  }, [roomId, streamUrl]);

  const loadHLSStream = () => {
    if (!videoRef.current) return;
    if (Hls.isSupported()) {
      console.log('Loading HLS stream:', hlsStreamUrl);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(hlsStreamUrl);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed');
        videoRef.current.play().catch(err => {
          console.error('HLS play error:', err);
          setError('Error playing HLS stream');
        });
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error('HLS fatal error:', data);
          setError('HLS stream error');
          hls.destroy();
        }
      });
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      videoRef.current.src = hlsStreamUrl;
      videoRef.current.play().catch(err => {
        console.error('Native HLS play error:', err);
        setError('Error playing HLS stream');
      });
    } else {
      setError('HLS not supported');
    }
  };

  const initializeWebRTC = () => {
    console.log('Initializing WebRTC, current peerConnection:', peerConnectionRef.current);
    if (peerConnectionRef.current) {
      console.log('Closing existing peerConnection');
      peerConnectionRef.current.close();
    }

    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Add TURN server for non-local testing
        // { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' }
      ],
    };
    peerConnectionRef.current = new RTCPeerConnection(configuration);
    console.log('New peerConnection created, signalingState:', peerConnectionRef.current.signalingState);

    peerConnectionRef.current.ontrack = (event) => {
      console.log('ontrack event, track kind:', event.track.kind, 'stream:', event.streams[0]);
      if (videoRef.current && event.streams[0]) {
        console.log('Setting video srcObject, stream tracks:', event.streams[0].getTracks());
        videoRef.current.srcObject = event.streams[0];
        videoRef.current.play()
          .then(() => {
            console.log('Video playback started');
            setIsStreamActive(true);
            setError(null);
          })
          .catch(err => {
            console.error('Video play error:', err);
            setError('Error playing WebRTC stream');
          });
      } else {
        console.error('ontrack: No videoRef or stream available');
      }
    };

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
      if (peerConnectionRef.current.connectionState === 'failed') {
        setError('WebRTC connection failed');
      } else if (peerConnectionRef.current.connectionState === 'connected') {
        setError(null);
      }
    };

    peerConnectionRef.current.oniceconnectionstatechange = () => {
      console.log('iceConnectionState:', peerConnectionRef.current.iceConnectionState);
      console.log('iceGatheringState:', peerConnectionRef.current.iceGatheringState);
    };

    peerConnectionRef.current.onsignalingstatechange = () => {
      console.log('signalingState:', peerConnectionRef.current.signalingState);
    };
  };

  return (
    <div className="mt-4 w-full max-w-md">
      <h2 className="text-xl font-bold mb-2">Live Stream</h2>
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <strong>Error: </strong>
          <span>{error}</span>
        </div>
      )}
      {!isStreamActive && !error && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4">
          <strong>Waiting: </strong>
          <span>The host has not started streaming yet.</span>
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={true} // Mute to ensure autoplay
        controls
        className="w-full h-48 bg-black rounded-lg"
      />
      <p className="text-sm text-gray-600 mt-2">
        {isStreamActive ? `Watching: ${streamSource === 'webcam' ? 'WebRTC Stream' : 'HLS Stream'}` : 'Waiting for stream...'}
      </p>
    </div>
  );
}

export default VideoPlayer;