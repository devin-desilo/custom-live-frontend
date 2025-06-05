// VideoPlayer.jsx
import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

function VideoPlayer({ streamUrl, socket, roomId, username, userId }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const playPromiseRef = useRef(null);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [streamSource, setStreamSource] = useState(null);
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [currentStream, setCurrentStream] = useState(null);
  const [isSocketReady, setIsSocketReady] = useState(false);

  const extractedRoomId = roomId || (streamUrl ? streamUrl.split('stream_')[1]?.split('.')[0] : null);
  const hlsStreamUrl = `${process.env.REACT_APP_HLS_PREVIEW_URL}/stream_${extractedRoomId}/index.m3u8`;

  // Check room status and stream availability
  useEffect(() => {
    if (!extractedRoomId) return;

    const checkRoomStatus = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/room/${extractedRoomId}`);
        if (response.ok) {
          const roomData = await response.json();
          console.log('Room status:', roomData);
          
          // Only update states if they're different to avoid unnecessary re-renders
          if (roomData.isStreamActive !== isStreamActive) {
            setIsStreamActive(roomData.isStreamActive);
          }
          if (roomData.streamSource !== streamSource) {
            setStreamSource(roomData.streamSource);
          }
          
          if (!roomData.isStreamActive) {
            setError('Stream is not active yet');
            setIsConnecting(false);
          } else if (!isStreamActive) {
            // Stream just became active
            setError(null);
            setIsConnecting(true);
          }
        } else {
          setError('Room not found');
          setIsConnecting(false);
        }
      } catch (err) {
        console.error('Error checking room status:', err);
        setError('Failed to check room status');
        setIsConnecting(false);
      }
    };

    // Initial check
    checkRoomStatus();
    
    // Only continue polling if stream is not active
    const interval = setInterval(() => {
      if (!isStreamActive) {
        checkRoomStatus();
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [extractedRoomId, isStreamActive]);

  // Socket connection management
  useEffect(() => {
    if (!socket || !extractedRoomId) return;

    console.log('Setting up socket for viewer in room:', extractedRoomId);

    const handleSocketConnect = () => {
      console.log('Socket connected for viewer:', socket.id);
      setIsSocketReady(true);
      
                // Join room and notify ready for stream with a small delay
          setTimeout(() => {
            console.log('Attempting to join room:', extractedRoomId);
            socket.emit('join-room', { roomId: extractedRoomId, userId: socket.id }, (response) => {
              console.log('Viewer join room response:', response);
              if (response?.success) {
                console.log('Successfully joined room, now emitting viewer_ready');
                setIsStreamActive(response.isStreamActive || false);
                setStreamSource(response.streamSource || null);
                
                // Always emit viewer_ready regardless of stream status
                // This ensures viewers get connected when stream becomes active
                setTimeout(() => {
                  console.log('Emitting viewer_ready event for room:', extractedRoomId);
                  socket.emit('viewer_ready', { roomId: extractedRoomId });
                }, 1500); // 1.5 second delay to ensure broadcaster is ready
                
                if (!response.isStreamActive) {
                  console.log('Stream not active yet, but viewer_ready sent for when it starts');
                  setError('Waiting for host to start streaming...');
                  setIsConnecting(false);
                }
                
                // Send join notification for chat
                console.log('Sending join_room_notification for chat');
                socket.emit('join_room_notification', { roomId: extractedRoomId, username });
              } else {
                console.error('Failed to join room:', response?.error);
                setError(response?.error || 'Failed to join room');
                setIsConnecting(false);
              }
            });
          }, 100); // Small delay to ensure socket is fully ready
    };

    const handleSocketDisconnect = () => {
      console.log('Socket disconnected for viewer');
      setIsSocketReady(false);
      setError('Connection lost');
    };

          // Set up socket event listeners
      if (socket.connected) {
        console.log('Socket already connected, calling handleSocketConnect');
        handleSocketConnect();
      } else {
        console.log('Socket not connected, waiting for connect event');
        socket.on('connect', handleSocketConnect);
      }
      
      socket.on('disconnect', handleSocketDisconnect);

      // Add stream error handler
      const handleStreamError = (data) => {
        console.log('Stream error received:', data);
        if (data.roomId === extractedRoomId) {
          setError(data.error);
          setIsConnecting(false);
        }
      };

      socket.on('stream_error', handleStreamError);

      return () => {
        socket.off('connect', handleSocketConnect);
        socket.off('disconnect', handleSocketDisconnect);
        socket.off('stream_error', handleStreamError);
        
        // Send leave notification
        if (extractedRoomId && username) {
          console.log('Sending leave notification');
          socket.emit('leave_room_notification', { roomId: extractedRoomId, username });
        }
      };
  }, [socket, extractedRoomId, username]);

  // Add effect to handle stream changes
  useEffect(() => {
    if (currentStream && videoRef.current) {
      console.log('Stream effect triggered - Stream:', currentStream);
      console.log('Stream tracks:', currentStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));

      const playVideo = async () => {
        // Add multiple checks to ensure video element is available
        if (!videoRef.current) {
          console.error('Video element not available for playback');
          setError('Video element not ready');
          return;
        }

        if (!currentStream) {
          console.error('No stream available for playback');
          setError('No stream available');
          return;
        }

        try {
          // Check if the stream is already assigned to avoid interruptions
          if (videoRef.current.srcObject === currentStream) {
            console.log('Stream already assigned to video element');
            return;
          }

          console.log('Setting new stream to video element');
          
          // Cancel any ongoing play promise
          if (playPromiseRef.current) {
            try {
              await playPromiseRef.current;
            } catch (err) {
              console.log('Previous play promise cancelled:', err.name);
            }
            playPromiseRef.current = null;
          }

          // Double-check video element is still available
          if (!videoRef.current) {
            console.error('Video element became null during setup');
            setError('Video element lost during setup');
            return;
          }

          // Pause the video first to ensure clean state
          videoRef.current.pause();
          
          // Final check before setting stream
          if (!videoRef.current) {
            console.error('Video element lost right before setting stream');
            setError('Video element unavailable');
            return;
          }

          // Set the new stream
          videoRef.current.srcObject = currentStream;
          
          // Wait for metadata to load with proper null checks
          const metadataPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Metadata load timeout'));
            }, 5000);

            // Check if video element still exists before setting handler
            if (!videoRef.current) {
              clearTimeout(timeout);
              reject(new Error('Video element no longer available'));
              return;
            }

            const handleMetadataLoaded = () => {
              clearTimeout(timeout);
              // Safe cleanup - check if element still exists
              if (videoRef.current) {
                videoRef.current.onloadedmetadata = null;
              }
              resolve();
            };

            videoRef.current.onloadedmetadata = handleMetadataLoaded;

            // If metadata is already loaded
            if (videoRef.current.readyState >= 1) {
              clearTimeout(timeout);
              videoRef.current.onloadedmetadata = null;
              resolve();
            }
          });

          await metadataPromise;
          console.log('Video metadata loaded successfully');

          // Now try to play
          if (videoRef.current && videoRef.current.srcObject === currentStream) {
            console.log('Starting video playback...');
            playPromiseRef.current = videoRef.current.play();
            await playPromiseRef.current;
            console.log('Video playing successfully');
            setError(null);
            setIsConnecting(false);
            playPromiseRef.current = null;
          }
        } catch (error) {
          console.error('Error in playVideo:', error);
          if (error.name === 'AbortError') {
            console.log('Play was aborted, likely due to stream change - this is normal');
          } else {
            console.error('Failed to play video stream:', error);
            setError('Failed to play video stream: ' + error.name);
            setIsConnecting(false);
          }
          playPromiseRef.current = null;
        }
      };

      playVideo();
    }
  }, [currentStream]);

  const cleanup = () => {
    console.log('Cleaning up VideoPlayer...');
    
    // Clean up video element
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        // Only clear srcObject for WebRTC streams, not HLS
        if (streamSource === 'webcam') {
          videoRef.current.srcObject = null;
        } else if (streamSource === 'obs') {
          videoRef.current.src = '';
        }
        videoRef.current.onloadedmetadata = null;
      } catch (err) {
        console.warn('Error cleaning up video element:', err);
      }
    }

    // Clean up HLS
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
        hlsRef.current = null;
      } catch (err) {
        console.warn('Error destroying HLS:', err);
      }
    }

    // Clean up WebRTC
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      } catch (err) {
        console.warn('Error closing peer connection:', err);
      }
    }

    // Clear pending candidates
    pendingCandidatesRef.current = [];
    setCurrentStream(null);
  };

  useEffect(() => {
    return cleanup;
  }, []);

  // Socket event handlers
  useEffect(() => {
    if (!socket || !extractedRoomId || !isSocketReady) return;

    const handleStreamStarted = (data) => {
      console.log('Stream started event received:', data);
      if (data.roomId === extractedRoomId) {
        setIsStreamActive(true);
        setStreamSource(data.source);
        setError(null);
        
        console.log(`Stream started with source: ${data.source}, preparing to initialize...`);
        
        // Only set connecting state if we're not already connected
        if (!peerConnectionRef.current || 
            peerConnectionRef.current.connectionState !== 'connected') {
          setIsConnecting(true);
        }
        
        // Clean up any existing connections first
        cleanup();
        
        // Wait a moment before initializing to ensure broadcaster is ready
        setTimeout(() => {
          if (data.source === 'webcam') {
            console.log('Initializing WebRTC for webcam stream...');
            // Always emit viewer ready for new streams
            console.log('Emitting viewer_ready for stream start');
            socket.emit('viewer_ready', { roomId: extractedRoomId });
          } else if (data.source === 'obs') {
            console.log('Initializing HLS for OBS stream...');
            console.log('HLS stream URL will be:', hlsStreamUrl);
            setError('Loading OBS stream...');
            setIsConnecting(true);
            // Give more time for OBS/FFmpeg to generate the HLS files
            setTimeout(() => {
              console.log('Starting HLS load after additional delay');
              loadHLSStream();
            }, 3000); // Extra delay for OBS stream processing
          }
        }, 1500); // 1.5 second delay to ensure broadcaster is fully ready
      }
    };

    const handleStreamEnded = (data) => {
      console.log('Stream ended event received:', data);
      if (data.roomId === extractedRoomId) {
        setIsStreamActive(false);
        setStreamSource(null);
        setError('Stream has ended');
        setIsConnecting(false);
        cleanup();
      }
    };

    const handleHLSFallback = (data) => {
      console.log('HLS fallback requested:', data);
      if (data.roomId === extractedRoomId) {
        console.log('Switching to HLS due to:', data.reason);
        setError('Loading stream... (High-quality mode)');
        setIsConnecting(true);
        
        // Clean up any WebRTC attempts
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
        }
        
        // Start HLS streaming for this viewer
        setTimeout(() => {
          loadHLSStream();
        }, 1000);
      }
    };

    const handleWebRTCOffer = async (data) => {
      console.log('WebRTC offer received:', data);
      console.log('Current extracted room ID:', extractedRoomId);
      console.log('Offer room ID:', data.roomId);
      
      if (data.roomId !== extractedRoomId) {
        console.log('Ignoring offer for different room');
        return;
      }
      
      try {
        console.log('Processing WebRTC offer for room:', extractedRoomId);
        setError('Connecting to stream...');
        setIsConnecting(true);
        
        // Clean up any existing peer connection
        if (peerConnectionRef.current) {
          console.log('Cleaning up existing peer connection before handling new offer');
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
        }

        // Initialize new peer connection
        console.log('Initializing new WebRTC connection for offer');
        initializeWebRTC();
        
        if (!peerConnectionRef.current) {
          console.error('Failed to initialize peer connection');
          setError('Failed to initialize connection');
          setIsConnecting(false);
          // Retry after a delay
          setTimeout(() => {
            console.log('Retrying viewer ready after peer connection failure');
            setIsConnecting(true);
            socket.emit('viewer_ready', { roomId: extractedRoomId });
          }, 3000);
          return;
        }

        const peerConnection = peerConnectionRef.current;
        console.log('Setting remote description with offer...', data.offer.type);
        
        // Validate offer has media
        const sdpLines = data.offer.sdp.split('\n');
        const hasVideo = sdpLines.some(line => line.includes('m=video'));
        const hasAudio = sdpLines.some(line => line.includes('m=audio'));
        console.log(`Offer validation: hasVideo=${hasVideo}, hasAudio=${hasAudio}`);
        
        if (!hasVideo && !hasAudio) {
          throw new Error('Offer contains no media tracks');
        }
        
        // Set remote description (offer)
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        console.log('Remote description set successfully, signaling state:', peerConnection.signalingState);

        // Process any pending ICE candidates
        console.log('Processing pending ICE candidates:', pendingCandidatesRef.current.length);
        while (pendingCandidatesRef.current.length > 0) {
          const candidate = pendingCandidatesRef.current.shift();
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('Added pending ICE candidate');
          } catch (err) {
            console.warn('Error adding pending ICE candidate:', err);
          }
        }

        // Create and send answer
        console.log('Creating answer...');
        const answer = await peerConnection.createAnswer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        
        console.log('Setting local description with answer...', answer.type);
        await peerConnection.setLocalDescription(answer);
        console.log('Local description set, signaling state:', peerConnection.signalingState);
        
        console.log('Sending answer to broadcaster:', data.broadcasterId);
        socket.emit('webrtc_answer', {
          roomId: extractedRoomId,
          broadcasterId: data.broadcasterId,
          answer: peerConnection.localDescription
        });
        
        console.log('WebRTC answer sent successfully');
        
        // Set timeout for connection establishment
        const connectionTimeout = setTimeout(() => {
          if (peerConnection.connectionState !== 'connected') {
            console.log('Connection timeout, retrying...');
            setError('Connection timeout, retrying...');
            // Retry connection
            setTimeout(() => {
              socket.emit('viewer_ready', { roomId: extractedRoomId });
            }, 2000);
          }
        }, 10000);

        // Clear timeout when connection succeeds
        const originalOnConnectionStateChange = peerConnection.onconnectionstatechange;
        peerConnection.onconnectionstatechange = () => {
          if (peerConnection.connectionState === 'connected') {
            clearTimeout(connectionTimeout);
          }
          if (originalOnConnectionStateChange) {
            originalOnConnectionStateChange();
          }
        };
        
      } catch (error) {
        console.error('Error handling WebRTC offer:', error);
        setError('Failed to connect to stream: ' + error.message);
        setIsConnecting(false);
        
        // Auto-retry after a delay
        setTimeout(() => {
          console.log('Auto-retrying connection after error');
          setIsConnecting(true);
          socket.emit('viewer_ready', { roomId: extractedRoomId });
        }, 5000);
      }
    };

    const handleWebRTCIceCandidate = async (data) => {
      console.log('ICE candidate received:', data);
      if (data.roomId !== extractedRoomId) return;

      try {
        if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
          // Store candidate for later processing
          pendingCandidatesRef.current.push(data.candidate);
        }
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
      }
    };

    // Add event listeners
    socket.on('stream_started', handleStreamStarted);
    socket.on('stream_ended', handleStreamEnded);
    socket.on('use_hls_fallback', handleHLSFallback);
    socket.on('webrtc_offer', handleWebRTCOffer);
    socket.on('webrtc_ice_candidate', handleWebRTCIceCandidate);

    // Cleanup function
    return () => {
      socket.off('stream_started', handleStreamStarted);
      socket.off('stream_ended', handleStreamEnded);
      socket.off('use_hls_fallback', handleHLSFallback);
      socket.off('webrtc_offer', handleWebRTCOffer);
      socket.off('webrtc_ice_candidate', handleWebRTCIceCandidate);
    };
  }, [socket, extractedRoomId, isSocketReady]);

  const initializeWebRTC = () => {
    console.log('Initializing WebRTC peer connection...');
    
    try {
      // Prevent duplicate initialization
      if (peerConnectionRef.current && 
          peerConnectionRef.current.connectionState !== 'failed' && 
          peerConnectionRef.current.connectionState !== 'closed') {
        console.log('WebRTC already initialized, skipping...');
        return;
      }

      if (peerConnectionRef.current) {
        console.log('Closing existing peer connection before reinitializing');
        peerConnectionRef.current.close();
      }

      const configuration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
      };

      peerConnectionRef.current = new RTCPeerConnection(configuration);

      peerConnectionRef.current.onicecandidate = (event) => {
        if (event.candidate && socket) {
          console.log('Sending ICE candidate to broadcaster');
          socket.emit('webrtc_ice_candidate', {
            roomId: extractedRoomId,
            targetId: null, // Will be determined by server based on room broadcaster
            candidate: event.candidate,
            isFromBroadcaster: false
          });
        }
      };

      peerConnectionRef.current.ontrack = (event) => {
        console.log('WebRTC track received:', event);
        console.log('Track details:', {
          kind: event.track.kind,
          enabled: event.track.enabled,
          readyState: event.track.readyState,
          muted: event.track.muted
        });
        
        if (event.streams && event.streams[0]) {
          const stream = event.streams[0];
          console.log('Stream received via WebRTC:', stream);
          console.log('Stream tracks:', stream.getTracks().map(t => ({
            kind: t.kind,
            enabled: t.enabled,
            readyState: t.readyState,
            muted: t.muted
          })));
          
          // Only set the stream if it's different from current
          if (currentStream !== stream) {
            console.log('Setting new stream from WebRTC');
            setCurrentStream(stream);
            setError(null);
            setIsConnecting(false);
            
            // Monitor track state changes
            stream.getTracks().forEach(track => {
              track.onended = () => {
                console.log(`Track ${track.kind} ended unexpectedly`);
                setError(`${track.kind} track ended`);
              };
              
              track.onmute = () => {
                console.log(`Track ${track.kind} muted`);
              };
              
              track.onunmute = () => {
                console.log(`Track ${track.kind} unmuted`);
              };
            });
          } else {
            console.log('Received same stream, not updating');
          }
          
        } else {
          console.warn('No streams found in track event');
        }
      };

      peerConnectionRef.current.onconnectionstatechange = () => {
        const state = peerConnectionRef.current?.connectionState;
        console.log('WebRTC connection state changed to:', state);
        
        switch (state) {
          case 'connecting':
            setIsConnecting(true);
            setError('Establishing connection...');
            break;
          case 'connected':
            setError(null);
            setIsConnecting(false);
            console.log('WebRTC successfully connected and stable');
            // Reset any reconnection attempts
            break;
          case 'disconnected':
            console.log('WebRTC disconnected - connection may recover automatically');
            setError('Connection temporarily interrupted...');
            // Don't immediately reconnect - give it time to recover
            setTimeout(() => {
              if (peerConnectionRef.current?.connectionState === 'disconnected') {
                console.log('Connection still disconnected after 10 seconds, checking if we should reconnect...');
                if (isStreamActive && streamSource === 'webcam') {
                  console.log('Attempting to recover connection...');
                  setError('Reconnecting...');
                  // Don't cleanup, just try to re-establish
                  socket.emit('viewer_ready', { roomId: extractedRoomId });
                }
              }
            }, 10000); // Wait 10 seconds before attempting recovery
            break;
          case 'failed':
            console.log('WebRTC connection failed - will attempt recovery');
            setError('Connection failed, attempting to reconnect...');
            setIsConnecting(true);
            // Only cleanup and restart if we're still trying to stream
            if (isStreamActive && streamSource === 'webcam') {
              setTimeout(() => {
                console.log('Restarting WebRTC after connection failure...');
                cleanup();
                initializeWebRTC();
              }, 3000);
            }
            break;
          case 'closed':
            console.log('WebRTC connection closed');
            if (isStreamActive && streamSource === 'webcam') {
              setError('Connection closed unexpectedly');
              setIsConnecting(false);
            }
            break;
        }
      };

      peerConnectionRef.current.oniceconnectionstatechange = () => {
        const iceState = peerConnectionRef.current?.iceConnectionState;
        console.log('ICE connection state changed to:', iceState);
        
        switch (iceState) {
          case 'checking':
            console.log('ICE checking - looking for connection path...');
            break;
          case 'connected':
          case 'completed':
            console.log('ICE connection established successfully');
            setError(null);
            setIsConnecting(false);
            break;
          case 'disconnected':
            console.log('ICE disconnected - may reconnect automatically');
            // Don't immediately fail - ICE can recover
            setTimeout(() => {
              if (peerConnectionRef.current?.iceConnectionState === 'disconnected') {
                console.log('ICE still disconnected after 8 seconds');
                if (isStreamActive && streamSource === 'webcam') {
                  setError('Network connection unstable...');
                }
              }
            }, 8000);
            break;
          case 'failed':
            console.log('ICE connection failed permanently');
            if (isStreamActive && streamSource === 'webcam') {
              setError('Network connection failed, reconnecting...');
              // Try to restart ICE
              if (peerConnectionRef.current) {
                peerConnectionRef.current.restartIce();
              }
            }
            break;
          case 'closed':
            console.log('ICE connection closed');
            break;
        }
      };

      console.log('WebRTC peer connection initialized');
    } catch (error) {
      console.error('Error initializing WebRTC:', error);
      setError('Failed to initialize WebRTC connection');
      setIsConnecting(false);
    }
  };

  const loadHLSStream = () => {
    console.log('Loading HLS stream:', hlsStreamUrl);
    setIsConnecting(true);
    setError('Loading HLS stream...');
    
    // Ensure we're in a state where video element should be rendered
    if (error && !isConnecting) {
      setError(null);
    }
    
    // Wait for video element to be available if not ready immediately
    const waitForVideoElement = (retries = 20) => {
      console.log(`Checking for video element... attempt ${21 - retries}`);
      console.log('Video ref current:', !!videoRef.current);
      console.log('Component states - isConnecting:', isConnecting, 'error:', error, 'isStreamActive:', isStreamActive);
      
      if (videoRef.current) {
        console.log('Video element available for HLS');
        startHLS();
      } else if (retries > 0) {
        console.log(`Waiting for video element... ${retries} retries left`);
        // Force a re-render to ensure video element is in DOM
        if (retries === 15) {
          console.log('Forcing component re-render to create video element');
          setIsConnecting(true);
          setError('Initializing video element...');
        }
        setTimeout(() => waitForVideoElement(retries - 1), 200);
      } else {
        console.error('Video element not available after waiting');
        setError('Video element initialization failed. Click retry to try again.');
        setIsConnecting(false);
      }
    };

    const startHLS = async () => {
      // First check if HLS stream is available
      try {
        console.log('Checking HLS stream availability:', hlsStreamUrl);
        const response = await fetch(hlsStreamUrl);
        if (!response.ok) {
          console.log('HLS stream not yet available, will retry...');
          setError('Stream not ready yet, retrying...');
          setTimeout(() => loadHLSStream(), 3000);
          return;
        }
        console.log('HLS stream is available, proceeding with load');
      } catch (error) {
        console.log('Error checking HLS availability:', error.message);
        setError('Checking stream availability...');
        setTimeout(() => loadHLSStream(), 3000);
        return;
      }

      // Clean up existing HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 10,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 5
        });

        hlsRef.current = hls;

        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          console.log('HLS media attached');
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('HLS manifest parsed, starting playback');
          if (videoRef.current) {
            videoRef.current.play().then(() => {
              console.log('HLS video playing');
              setError(null);
              setIsConnecting(false);
            }).catch(err => {
              console.error('Error playing HLS video:', err);
              setError('Failed to play video');
              setIsConnecting(false);
            });
          }
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('HLS error:', data);
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log('Fatal network error, trying to recover...');
                setError('Network error, retrying...');
                setTimeout(() => {
                  if (hlsRef.current) {
                    hlsRef.current.startLoad();
                  }
                }, 1000);
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log('Fatal media error, trying to recover...');
                setError('Media error, recovering...');
                setTimeout(() => {
                  if (hlsRef.current) {
                    hlsRef.current.recoverMediaError();
                  }
                }, 1000);
                break;
              default:
                console.error('Fatal error, cannot recover:', data.details);
                if (data.details === 'manifestLoadError' || data.details === 'manifestParsingError') {
                  setError('Stream not ready yet, retrying...');
                  setTimeout(() => {
                    console.log('Retrying HLS stream load...');
                    loadHLSStream();
                  }, 5000);
                } else {
                  setError('Stream connection failed: ' + data.details);
                  setIsConnecting(false);
                  hls.destroy();
                }
                break;
            }
          } else {
            console.warn('Non-fatal HLS error:', data.details);
          }
        });

        hls.loadSource(hlsStreamUrl);
        hls.attachMedia(videoRef.current);
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS support
        videoRef.current.src = hlsStreamUrl;
        videoRef.current.addEventListener('loadedmetadata', () => {
          videoRef.current.play().then(() => {
            console.log('Native HLS video playing');
            setError(null);
            setIsConnecting(false);
          }).catch(err => {
            console.error('Error playing native HLS video:', err);
            setError('Failed to play video');
            setIsConnecting(false);
          });
        });
      } else {
        setError('HLS is not supported in this browser');
        setIsConnecting(false);
      }
    };

    // Start waiting for video element
    waitForVideoElement();
  };

  // Initialize streaming when component mounts and stream is active
  useEffect(() => {
    if (isStreamActive && streamSource && isSocketReady) {
      console.log(`Initializing ${streamSource} streaming...`);
      setIsConnecting(true);
      
      if (streamSource === 'webcam') {
        // Add retry logic for WebRTC
        const initWebRTCWithRetry = async (retries = 3) => {
          for (let i = 0; i < retries; i++) {
            try {
              console.log(`WebRTC initialization attempt ${i + 1}/${retries}`);
              initializeWebRTC();
              
              // Wait a moment to see if initialization was successful
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              if (peerConnectionRef.current && 
                  peerConnectionRef.current.connectionState !== 'failed' &&
                  peerConnectionRef.current.connectionState !== 'closed') {
                console.log('WebRTC initialization appears successful');
                break;
              } else {
                console.log(`WebRTC initialization attempt ${i + 1} failed, retrying...`);
                cleanup();
              }
            } catch (error) {
              console.error(`WebRTC initialization attempt ${i + 1} error:`, error);
              cleanup();
              if (i === retries - 1) {
                setError('Failed to initialize WebRTC after multiple attempts');
                setIsConnecting(false);
              }
            }
          }
        };
        
        initWebRTCWithRetry();
      } else if (streamSource === 'obs') {
        console.log('Initializing HLS for OBS stream from effect...');
        setError('Preparing OBS stream...');
        // Give FFmpeg more time to start and generate HLS files
        setTimeout(() => {
          console.log('Loading HLS stream after delay...');
          loadHLSStream();
        }, 5000); // 5 second delay for OBS/FFmpeg startup
      }
    }
  }, [isStreamActive, streamSource, isSocketReady]);

  // Add effect to monitor connection health
  useEffect(() => {
    if (!peerConnectionRef.current || !isStreamActive || streamSource !== 'webcam') {
      return;
    }

    const healthCheckInterval = setInterval(() => {
      const pc = peerConnectionRef.current;
      if (!pc) return;

      const connectionState = pc.connectionState;
      const iceState = pc.iceConnectionState;
      
      // Only log if state has changed or there's an issue
      const isHealthy = (connectionState === 'connected' || connectionState === 'connecting') && 
                       (iceState === 'connected' || iceState === 'completed' || iceState === 'checking');
      
      if (!isHealthy) {
        console.log('Health check - Connection:', connectionState, 'ICE:', iceState);
      }
      
      // Check if we have active tracks
      const receivers = pc.getReceivers();
      const activeTracks = receivers.filter(receiver => 
        receiver.track && receiver.track.readyState === 'live'
      );
      
      // Only log track issues if there's a problem
      if (!isHealthy || activeTracks.length === 0) {
        console.log(`Health check - Active tracks: ${activeTracks.length}/${receivers.length}`);
      }
      
      // If connection looks good but we have no active tracks, there might be an issue
      if ((connectionState === 'connected' || iceState === 'connected') && activeTracks.length === 0) {
        console.warn('Connection established but no active tracks - possible issue');
        // Don't set error immediately, give it some time
        setTimeout(() => {
          const currentActiveTracks = pc.getReceivers().filter(r => 
            r.track && r.track.readyState === 'live'
          );
          if (currentActiveTracks.length === 0) {
            setError('Stream connection established but no media received');
          }
        }, 3000);
      }
      
    }, 10000); // Check every 10 seconds instead of 5

    return () => {
      clearInterval(healthCheckInterval);
    };
  }, [peerConnectionRef.current, isStreamActive, streamSource]);

  const renderContent = () => {
    // Always render the video element to ensure videoRef.current is available
    const videoElement = (
      <video
        ref={videoRef}
        controls
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover rounded-lg"
        style={{ backgroundColor: '#000' }}
      />
    );

    // Show overlay messages based on state, but keep video element in DOM
    let overlay = null;

    if (error && !isConnecting) {
      overlay = (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 text-center p-4">
          <div className="text-red-500 text-lg mb-2">⚠️ Connection Error</div>
          <div className="text-gray-200 text-sm mb-4">{error}</div>
          <button 
            onClick={() => {
              setError(null);
              setIsConnecting(true);
              if (streamSource === 'obs') {
                setTimeout(() => loadHLSStream(), 1000);
              } else {
                socket.emit('viewer_ready', { roomId: extractedRoomId });
              }
            }} 
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Retry Connection
          </button>
        </div>
      );
    } else if (!isStreamActive) {
      overlay = (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 text-center p-4">
          <div className="text-gray-300 text-lg mb-2">📺 Waiting for Stream</div>
          <div className="text-gray-400 text-sm mb-4">The broadcaster hasn't started streaming yet</div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      );
    } else if (isConnecting) {
      const connectionType = hlsRef.current ? 'HLS' : 'WebRTC';
      const connectionDetails = hlsRef.current ? 
        'Loading high-quality stream' : 
        'Establishing low-latency connection';
        
      overlay = (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 text-center p-4">
          <div className="text-blue-500 text-lg mb-2">🔄 Connecting to stream...</div>
          <div className="text-gray-300 text-sm mb-4">{connectionDetails}</div>
          <div className="text-xs text-gray-400 mb-2">Connection: {connectionType}</div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      );
    }

    return (
      <div className="relative">
        {videoElement}
        {overlay}
        {/* Connection type indicator - only show when stream is active */}
        {!overlay && (
          <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
            {hlsRef.current ? '📡 HLS' : '⚡ WebRTC'}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-96 bg-gray-900 rounded-lg overflow-hidden">
      {renderContent()}
    </div>
  );
}

export default VideoPlayer;