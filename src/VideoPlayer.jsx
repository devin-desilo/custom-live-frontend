import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import io from 'socket.io-client';

// Create socket connection with authentication
const createSocket = (roomId) => {
  // Generate a temporary token for authentication
  const token = `temp_${Math.random().toString(36).substring(2, 15)}`;
  
  return io('http://localhost:5000', {
    query: { token },
    auth: { token },
    // Only connect when explicitly requested
    autoConnect: false
  });
};

function VideoPlayer({ streamUrl }) {
  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [streamSource, setStreamSource] = useState(null);
  const [error, setError] = useState(null);
  const hlsRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const [pendingCandidates, setPendingCandidates] = useState([]);
  
  // Extract roomId from streamUrl
  const roomId = streamUrl ? streamUrl.split('stream_')[1]?.split('.')[0] : null;
  
  // Update the stream URLs
  const hlsStreamUrl = `http://localhost:8080/hls/stream_${roomId}.m3u8`;
  const webrtcStreamUrl = `http://localhost:8000/webrtc/stream_${roomId}`;

  useEffect(() => {
    if (!roomId) {
      console.error('No roomId found in streamUrl:', streamUrl);
      return;
    }

    console.log('Initializing VideoPlayer for room:', roomId);
    
    // Initialize socket connection
    console.log('Creating socket connection...');
    socketRef.current = createSocket(roomId);
    
    // Add connection event listeners
    socketRef.current.on('connect', () => {
      console.log('Socket connection established');
      console.log('Socket ID:', socketRef.current.id);
      
      // Move join-room emit inside connect event
      console.log('Attempting to join room:', roomId);
      socketRef.current.emit('join-room', { roomId, userId: socketRef.current.id }, (response) => {
        console.log('Join room response:', response);
        // Check if stream is already active when joining
        if (response && response.isStreamActive) {
          console.log('Stream is already active when joining');
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
      console.error('Socket connection error:', error);
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });
    
    // Connect socket when component mounts
    console.log('Initiating socket connection...');
    socketRef.current.connect();
    
    // Listen for stream events
    console.log('Setting up stream event listeners...');
    
    socketRef.current.on('stream_started', (data) => {
      console.log('Received stream_started event:', data);
      setIsStreamActive(true);
      setStreamSource(data.source);
      setError(null);

      if (data.source === 'webcam') {
        console.log('Initializing WebRTC for webcam stream');
        initializeWebRTC();
      } else if (data.source === 'obs') {
        console.log('Loading HLS stream for OBS');
        loadHLSStream();
      }
    });
    
    socketRef.current.on('stream_ended', (data) => { 
      console.log('Received stream_ended event:', data);
      setIsStreamActive(false);
      setStreamSource(null);
      setPendingCandidates([]);
      
      // Clean up HLS instance
      if (hlsRef.current) {
        console.log('Cleaning up HLS instance');
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      // Clean up WebRTC connection
      if (peerConnectionRef.current) {
        console.log('Cleaning up WebRTC connection');
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    });

    // WebRTC signaling handlers
    socketRef.current.on('webrtc_offer', (data) => {
      console.log('Received WebRTC offer:', data);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp))
          .then(() => {
            console.log('Remote description set with offer');
            return peerConnectionRef.current.createAnswer();
          })
          .then(answer => {
            console.log('Created answer');
            return peerConnectionRef.current.setLocalDescription(answer);
          })
          .then(() => {
            console.log('Sending WebRTC answer');
            socketRef.current.emit('webrtc_answer', {
              roomId,
              sdp: peerConnectionRef.current.localDescription,
              broadcasterId: data.broadcasterId
            });
          })
          .catch(err => console.error('Error handling WebRTC offer:', err));
      }
    });

    socketRef.current.on('webrtc_ice_candidate', (data) => {
      console.log('Received ICE candidate from server:', data);
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate))
          .then(() => console.log('ICE candidate added from server'))
          .catch(err => console.error('Error adding ICE candidate:', err));
      } else {
        console.log('Storing ICE candidate for later');
        setPendingCandidates(prev => [...prev, data.candidate]);
      }
    });
    
    // Add a listener for all events to debug
    socketRef.current.onAny((eventName, ...args) => {
      console.log('Received socket event:', eventName, args);
    });
    
    // Clean up socket connection when component unmounts
    return () => {
      if (socketRef.current) {
        console.log('Cleaning up socket connection');
        socketRef.current.off('stream_started');
        socketRef.current.off('stream_ended');
        socketRef.current.off('webrtc_offer');
        socketRef.current.off('webrtc_ice_candidate');
        socketRef.current.disconnect();
      }
      
      // Clean up HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      // Clean up WebRTC connection
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
    };
  }, [roomId, streamUrl]);

  const loadHLSStream = () => {
    if (videoRef.current && Hls.isSupported()) {
      console.log('Loading HLS stream:', hlsStreamUrl);
      
      // Clean up previous HLS instance if it exists
      if (hlsRef.current) {
        console.log('Cleaning up previous HLS instance');
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        debug: false,
        xhrSetup: (xhr) => {
          const url = new URL(xhr.responseURL);
          url.searchParams.append('t', Date.now());
          xhr.open('GET', url.toString(), true);
        }
      });
      
      hlsRef.current = hls;
      
      hls.loadSource(hlsStreamUrl);
      hls.attachMedia(videoRef.current);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed, playing stream:', hlsStreamUrl);
        videoRef.current.play().catch(err => {
          console.error('Error playing video:', err);
          setError('Error playing video. Please try refreshing the page.');
        });
      });
      
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (isStreamActive) {
                console.log('Network error, retrying...');
                hls.startLoad();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('Media error, recovering...');
              hls.recoverMediaError();
              break;
            default:
              if (isStreamActive) {
                console.error('Unrecoverable HLS error:', data);
                setError('Stream error. Please try refreshing the page.');
              }
              hls.destroy();
              break;
          }
        }
      });
    } else if (videoRef.current?.canPlayType('application/vnd.apple.mpegurl')) {
      videoRef.current.src = hlsStreamUrl;
      videoRef.current.addEventListener('loadedmetadata', () => {
        console.log('Native HLS loaded, playing stream:', hlsStreamUrl);
        videoRef.current.play().catch(err => {
          console.error('Error playing video:', err);
          setError('Error playing video. Please try refreshing the page.');
        });
      });
    } else {
      console.error('HLS not supported on this browser');
      setError('Your browser does not support HLS streaming.');
    }
  };

  const initializeWebRTC = () => {
    console.log('Initializing WebRTC for viewer');
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    peerConnectionRef.current = new RTCPeerConnection(configuration);
    console.log('Peer connection created for viewer');
    
    // Handle incoming tracks
    peerConnectionRef.current.ontrack = (event) => {
      console.log('Received track from WebRTC:', event.track.kind);
      if (videoRef.current && event.streams[0]) {
        console.log('Setting video source object with received stream');
        const stream = event.streams[0];
        videoRef.current.srcObject = stream;
        
        // Ensure video plays automatically
        videoRef.current.onloadedmetadata = () => {
          console.log('Video metadata loaded, attempting to play');
          videoRef.current.play()
            .then(() => {
              console.log('Video playback started successfully');
              setIsStreamActive(true);
            })
            .catch(err => {
              console.error('Error playing video:', err);
              setError('Error playing video. Please try refreshing the page.');
            });
        };
      }
    };

    // Handle connection state changes
    peerConnectionRef.current.onconnectionstatechange = () => {
      console.log('Connection state changed:', peerConnectionRef.current.connectionState);
      if (peerConnectionRef.current.connectionState === 'failed') {
        console.error('WebRTC connection failed');
        setError('Connection failed. Please try refreshing the page.');
      }
    };

    // Handle ICE connection state changes
    peerConnectionRef.current.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnectionRef.current.iceConnectionState);
    };

    // Handle ICE candidates
    peerConnectionRef.current.onicecandidate = (event) => {
      console.log('Received ICE candidate from WebRTC');
      if (event.candidate) {
        socketRef.current.emit('webrtc_ice_candidate', {
          roomId,
          candidate: event.candidate
        });
      }
    };

    // Listen for WebRTC offer from broadcaster
    socketRef.current.on('webrtc_offer', (data) => {
      console.log('Received WebRTC offer:', data);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp))
          .then(() => {
            console.log('Remote description set with offer');
            return peerConnectionRef.current.createAnswer();
          })
          .then(answer => {
            console.log('Created answer');
            return peerConnectionRef.current.setLocalDescription(answer);
          })
          .then(() => {
            console.log('Sending WebRTC answer');
            socketRef.current.emit('webrtc_answer', {
              roomId,
              sdp: peerConnectionRef.current.localDescription,
              broadcasterId: data.broadcasterId
            });
          })
          .catch(err => console.error('Error handling WebRTC offer:', err));
      }
    });

    // Listen for ICE candidates from broadcaster
    socketRef.current.on('webrtc_ice_candidate', (data) => {
      console.log('Received ICE candidate from server:', data);
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate))
          .then(() => console.log('ICE candidate added from server'))
          .catch(err => console.error('Error adding ICE candidate:', err));
      } else {
        console.log('Storing ICE candidate for later');
        setPendingCandidates(prev => [...prev, data.candidate]);
      }
    });

    // Apply any pending ICE candidates
    pendingCandidates.forEach(candidate => {
      console.log('Applying pending ICE candidate');
      peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate))
        .catch(err => console.error('Error adding pending ICE candidate:', err));
    });
    setPendingCandidates([]);
  };

  return (
    <div className="mt-4 w-full max-w-md">
      <h2 className="text-xl font-bold mb-2">Live Stream</h2>
      {error ? (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      ) : !isStreamActive ? (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded relative mb-4">
          <strong className="font-bold">Waiting for stream: </strong>
          <span className="block sm:inline">The host has not started streaming yet.</span>
        </div>
      ) : null}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        controls
        className="w-full h-48 bg-black rounded-lg"
      />
      <p className="text-sm text-gray-600 mt-2">
        {isStreamActive ? (
          <>
            Watching: {streamSource === 'webcam' ? 'WebRTC Stream' : 'HLS Stream'}
            {streamSource && <span className="ml-2">(Source: {streamSource})</span>}
          </>
        ) : (
          'Waiting for stream to start...'
        )}
      </p>
    </div>
  );
}

export default VideoPlayer;
