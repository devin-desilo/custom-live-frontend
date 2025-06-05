import React, { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';

function Broadcaster({ roomId, socket }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [streamSource, setStreamSource] = useState('webcam');
  const [availableCameras, setAvailableCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [socketError, setSocketError] = useState(null);
  const hlsStreamUrl = `${process.env.REACT_APP_HLS_PREVIEW_URL}/stream_${roomId}/index.m3u8`;

  // Use the socket passed from App component
  useEffect(() => {
    if (!socket) return;

    const handleConnect = () => {
      console.log('Broadcaster socket connected:', socket.id);
      setIsConnected(true);
      setSocketError(null);
      
      // Join room for broadcaster
      socket.emit('join-room', { roomId, userId: socket.id }, (response) => {
        console.log('Broadcaster join room response:', response);
        if (!response?.success) {
          console.error('Failed to join room as broadcaster:', response?.error);
          setSocketError(response?.error || 'Failed to join room');
        }
      });
    };

    const handleDisconnect = () => {
      console.log('Broadcaster socket disconnected');
      setIsConnected(false);
      setSocketError('Connection lost');
    };

    const handleConnectError = (error) => {
      console.error('Broadcaster socket connection error:', error);
      setSocketError('Connection error');
      setIsConnected(false);
    };

    // Set up socket event listeners
    if (socket.connected) {
      handleConnect();
    } else {
      socket.on('connect', handleConnect);
    }
    
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
    };
  }, [socket, roomId]);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const cleanup = () => {
      if (socket) {
        try {
          socket.off('viewer_joined');
          socket.off('webrtc_answer');
          socket.off('webrtc_ice_candidate');
          socket.off('viewer_left');
          socket.off('viewer_ready');
          socket.off('get_stream_status');
        } catch (err) {
          console.warn('Error during socket cleanup:', err);
        }
      }
    };

    socket.on('viewer_joined', (data) => {
      console.log('New viewer joined:', data);
      if (isStreaming && streamSource === 'webcam') {
        console.log('Creating peer connection for new viewer:', data.viewerId);
        // Handle viewer join synchronously
        createPeerConnection(data.viewerId).catch(error => {
          console.error('Error creating peer connection:', error);
        });
      } else {
        console.log('Not creating peer connection - conditions not met');
        console.log('isStreaming:', isStreaming, 'streamSource:', streamSource);
      }
    });

    socket.on('viewer_ready', (data) => {
      console.log('Viewer ready event received:', data);
      console.log('Current streaming state:', { isStreaming, streamSource });
      console.log('Available stream tracks:', streamRef.current ? streamRef.current.getTracks().length : 0);
      
      if (isStreaming && streamSource === 'webcam') {
        console.log('Creating peer connection for ready viewer:', data.viewerId);
        
        // If viewer requires keyframe, force one before creating connection
        if (data.requiresKeyframe && streamRef.current) {
          console.log('Forcing keyframe for new viewer:', data.viewerId);
          try {
            const videoTrack = streamRef.current.getVideoTracks()[0];
            if (videoTrack && typeof videoTrack.requestFrame === 'function') {
              videoTrack.requestFrame();
            }
          } catch (err) {
            console.warn('Could not request keyframe:', err);
          }
        }
        
        // Add small delay to ensure keyframe is generated
        setTimeout(() => {
          createPeerConnection(data.viewerId).catch(error => {
            console.error('Error creating peer connection:', error);
          });
        }, 500);
      } else {
        console.log('Cannot create peer connection - conditions not met');
        console.log('isStreaming:', isStreaming, 'streamSource:', streamSource);
        console.log('Stream available:', streamRef.current ? 'Yes' : 'No');
      }
    });

    socket.on('webrtc_answer', async (data) => {
      console.log('Received answer from viewer:', data);
      if (data.roomId !== roomId) return;
      
      const peerConnection = peerConnectionsRef.current.get(data.viewerId);
      if (peerConnection) {
        try {
          console.log('Setting remote description from answer for viewer:', data.viewerId);
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log('Remote description set successfully');
          
          // Add any pending ICE candidates
          const pendingCandidates = pendingCandidatesRef.current.get(data.viewerId) || [];
          console.log('Adding pending ICE candidates for viewer:', data.viewerId, pendingCandidates.length);
          for (const candidate of pendingCandidates) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingCandidatesRef.current.delete(data.viewerId);
        } catch (error) {
          console.error('Error setting remote description:', error);
        }
      } else {
        console.error('No peer connection found for viewer:', data.viewerId);
      }
    });

    socket.on('webrtc_ice_candidate', async (data) => {
      console.log('Received ICE candidate from viewer:', data);
      if (data.roomId !== roomId) return;
      
      const viewerId = data.senderId;
      const peerConnection = peerConnectionsRef.current.get(viewerId);
      if (peerConnection) {
        if (peerConnection.remoteDescription) {
          try {
            console.log('Adding ICE candidate for viewer:', viewerId);
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (error) {
            console.error('Error adding ICE candidate:', error);
          }
        } else {
          console.log('Storing ICE candidate for later, remote description not set yet');
          const pendingCandidates = pendingCandidatesRef.current.get(viewerId) || [];
          pendingCandidates.push(data.candidate);
          pendingCandidatesRef.current.set(viewerId, pendingCandidates);
        }
      } else {
        console.error('No peer connection found for viewer:', viewerId);
      }
    });

    socket.on('viewer_left', (data) => {
      console.log('Viewer left:', data);
      const peerConnection = peerConnectionsRef.current.get(data.viewerId);
      if (peerConnection) {
        console.log('Closing peer connection for viewer:', data.viewerId);
        peerConnection.close();
        peerConnectionsRef.current.delete(data.viewerId);
        pendingCandidatesRef.current.delete(data.viewerId);
      }
    });

    // Handle get_stream_status requests
    socket.on('get_stream_status', (data, callback) => {
      console.log('Received stream status request from viewer:', data);
      const status = {
        isActive: isStreaming,
        source: streamSource
      };
      console.log('Sending stream status response:', status);
      callback(status);
    });

    return cleanup;
  }, [socket, isStreaming, streamSource]);

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

  const createPeerConnection = async (viewerId) => {
    try {
      console.log('Creating peer connection for viewer:', viewerId);
      
      // Temporarily disable connection limit for debugging
      // // Limit WebRTC connections to first 3 viewers for performance
      // const currentConnections = peerConnectionsRef.current.size;
      // const MAX_WEBRTC_CONNECTIONS = 3;
      
      // if (currentConnections >= MAX_WEBRTC_CONNECTIONS) {
      //   console.log(`Max WebRTC connections (${MAX_WEBRTC_CONNECTIONS}) reached. Viewer ${viewerId} will use HLS.`);
      //   // Notify the viewer to use HLS instead
      //   socket.emit('use_hls_fallback', {
      //     roomId,
      //     viewerId,
      //     reason: 'max_webrtc_connections_reached'
      //   });
      //   return;
      // }
      
      // Close existing connection for this viewer if it exists
      if (peerConnectionsRef.current.has(viewerId)) {
        const existingConnection = peerConnectionsRef.current.get(viewerId);
        console.log('Closing existing connection for viewer:', viewerId);
        existingConnection.close();
        peerConnectionsRef.current.delete(viewerId);
        pendingCandidatesRef.current.delete(viewerId);
      }
      
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
      });

      // Store peer connection immediately
      peerConnectionsRef.current.set(viewerId, peerConnection);
      console.log(`WebRTC connections: ${peerConnectionsRef.current.size}`);

      // Add local stream tracks to peer connection
      if (streamRef.current) {
        const tracks = streamRef.current.getTracks();
        console.log('Available tracks to add:', tracks.map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState })));
        
        tracks.forEach(track => {
          console.log('Adding track to peer connection:', track.kind, 'enabled:', track.enabled, 'readyState:', track.readyState);
          try {
            const sender = peerConnection.addTrack(track, streamRef.current);
            console.log('Track sender created:', sender);
          } catch (err) {
            console.error('Error adding track:', err);
          }
        });

        // Log the transceivers after adding tracks
        const transceivers = peerConnection.getTransceivers();
        console.log('Peer connection transceivers:', transceivers.map(t => ({
          kind: t.kind,
          direction: t.direction,
          currentDirection: t.currentDirection,
          sender: !!t.sender,
          receiver: !!t.receiver
        })));
      } else {
        console.error('No local stream available for peer connection');
        throw new Error('No local stream available');
      }

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('Sending ICE candidate to viewer:', viewerId, 'candidate:', event.candidate.candidate);
          socket.emit('webrtc_ice_candidate', {
            roomId,
            targetId: viewerId,
            candidate: event.candidate,
            isFromBroadcaster: true
          });
        } else {
          console.log('ICE gathering complete for viewer:', viewerId);
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        console.log(`Connection state for viewer ${viewerId}:`, state);
        
        switch (state) {
          case 'connecting':
            console.log(`Connecting to viewer ${viewerId}...`);
            break;
          case 'connected':
            console.log(`Successfully connected to viewer ${viewerId}`);
            // Verify tracks are still active
            const senders = peerConnection.getSenders();
            senders.forEach(sender => {
              if (sender.track) {
                console.log(`Track ${sender.track.kind} is ${sender.track.readyState} for viewer ${viewerId}`);
              }
            });
            break;
          case 'disconnected':
            console.log(`Disconnected from viewer ${viewerId}, but connection may recover`);
            // Don't immediately clean up - let it try to recover
            setTimeout(() => {
              if (peerConnection.connectionState === 'disconnected') {
                console.log(`Connection to viewer ${viewerId} still disconnected after 10 seconds`);
              }
            }, 10000);
            break;
          case 'failed':
            console.log(`Connection failed for viewer ${viewerId}, cleaning up`);
            peerConnection.close();
            peerConnectionsRef.current.delete(viewerId);
            pendingCandidatesRef.current.delete(viewerId);
            console.log(`WebRTC connections after cleanup: ${peerConnectionsRef.current.size}`);
            break;
          case 'closed':
            console.log(`Connection closed for viewer ${viewerId}`);
            peerConnectionsRef.current.delete(viewerId);
            pendingCandidatesRef.current.delete(viewerId);
            console.log(`WebRTC connections after cleanup: ${peerConnectionsRef.current.size}`);
            break;
        }
      };

      // Handle ICE connection state changes
      peerConnection.oniceconnectionstatechange = () => {
        const iceState = peerConnection.iceConnectionState;
        console.log(`ICE connection state for viewer ${viewerId}:`, iceState);
        
        switch (iceState) {
          case 'connected':
          case 'completed':
            console.log(`ICE connection established with viewer ${viewerId}`);
            break;
          case 'failed':
            console.log(`ICE connection failed for viewer ${viewerId}, attempting restart`);
            // Try ICE restart before giving up
            try {
              peerConnection.restartIce();
            } catch (err) {
              console.error('Error restarting ICE:', err);
            }
            break;
          case 'disconnected':
            console.log(`ICE disconnected for viewer ${viewerId}, may recover automatically`);
            break;
        }
      };

      // Create and send offer with better error handling
      console.log('Creating offer for viewer:', viewerId);
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
      console.log('Created offer for viewer:', viewerId, 'offer type:', offer.type);
      
      await peerConnection.setLocalDescription(offer);
      console.log('Set local description for viewer:', viewerId, 'state:', peerConnection.signalingState);
      
      // Validate that we have tracks in the offer
      const sdpLines = offer.sdp.split('\n');
      const hasVideo = sdpLines.some(line => line.includes('m=video'));
      const hasAudio = sdpLines.some(line => line.includes('m=audio'));
      console.log(`Offer validation for viewer ${viewerId}: hasVideo=${hasVideo}, hasAudio=${hasAudio}`);
      
      if (!hasVideo && !hasAudio) {
        throw new Error('No media tracks found in offer');
      }
      
      console.log('Sending offer to viewer:', viewerId);
      socket.emit('webrtc_offer', {
        roomId,
        viewerId,
        offer: peerConnection.localDescription
      });

      // Set up connection timeout
      const connectionTimeout = setTimeout(() => {
        if (peerConnection.connectionState === 'connecting' || peerConnection.connectionState === 'new') {
          console.log(`Connection timeout for viewer ${viewerId}, closing connection`);
          peerConnection.close();
          peerConnectionsRef.current.delete(viewerId);
          pendingCandidatesRef.current.delete(viewerId);
        }
      }, 15000); // 15 second timeout

      // Clear timeout when connection succeeds
      const originalOnConnectionStateChange = peerConnection.onconnectionstatechange;
      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'connected') {
          clearTimeout(connectionTimeout);
        }
        if (originalOnConnectionStateChange) {
          originalOnConnectionStateChange.call();
        }
      };

      console.log('Peer connection setup complete for viewer:', viewerId);
    } catch (error) {
      console.error('Error creating peer connection for viewer:', viewerId, error);
      // Clean up on error
      if (peerConnectionsRef.current.has(viewerId)) {
        peerConnectionsRef.current.get(viewerId).close();
        peerConnectionsRef.current.delete(viewerId);
        pendingCandidatesRef.current.delete(viewerId);
      }
      throw error;
    }
  };

  const startStreaming = async () => {
    try {
      if (streamSource === 'webcam') {
        const constraints = {
          video: {
            deviceId: selectedCamera ? { exact: selectedCamera } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: true
        };

        console.log('Getting user media with constraints:', constraints);
        streamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Got user media stream:', streamRef.current.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));
        
        // Monitor stream health
        streamRef.current.getTracks().forEach(track => {
          track.onended = () => {
            console.error(`Broadcaster track ${track.kind} ended unexpectedly!`);
            setIsStreaming(false);
            alert(`${track.kind} track ended unexpectedly. Please restart streaming.`);
          };
          
          track.onmute = () => {
            console.warn(`Broadcaster track ${track.kind} muted`);
          };
          
          track.onunmute = () => {
            console.log(`Broadcaster track ${track.kind} unmuted`);
          };
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
          await videoRef.current.play();
        }
        
        // Emit start streaming event
        console.log('Emitting start_streaming event');
        await new Promise((resolve, reject) => {
          socket.emit('start_streaming', { roomId, source: 'webcam' }, (response) => {
            console.log('Start streaming response:', response);
            if (response?.success) {
              console.log('Stream started successfully');
              setIsStreaming(true);
              resolve(response);
            } else {
              console.error('Failed to start streaming:', response?.error);
              reject(new Error(response?.error || 'Failed to start streaming'));
            }
          });
        });

        // Create peer connections for existing viewers
        try {
          console.log('Checking for existing viewers');
          const roomData = await fetch(`${process.env.REACT_APP_BACKEND_URL}/room/${roomId}`).then(res => res.json());
          if (roomData.viewers && roomData.viewers.length > 0) {
            console.log('Creating peer connections for existing viewers:', roomData.viewers);
            for (const viewerId of roomData.viewers) {
              await createPeerConnection(viewerId);
            }
          }
        } catch (error) {
          console.error('Error creating peer connections for existing viewers:', error);
        }
      } else if (streamSource === 'obs') {
        console.log('Starting OBS stream for room:', roomId);
        
        // First emit start_streaming event
        console.log('Emitting start_streaming event for OBS');
        await new Promise((resolve, reject) => {
          socket.emit('start_streaming', { roomId, source: 'obs' }, (response) => {
            console.log('Start streaming response:', response);
            if (response?.success) {
              console.log('OBS stream started successfully');
              setIsStreaming(true);
              resolve(response);
            } else {
              console.error('Failed to start OBS stream:', response?.error);
              reject(new Error(response?.error || 'Failed to start streaming'));
            }
          });
        });
        
        // Start checking for HLS stream
        const checkHLSStream = async () => {
          try {
            console.log('Checking HLS stream at:', hlsStreamUrl);
            const response = await fetch(hlsStreamUrl);
            if (response.ok) {
              console.log('HLS stream is available');
              if (videoRef.current) {
                if (Hls.isSupported()) {
                  const hls = new Hls({ 
                    enableWorker: true, 
                    lowLatencyMode: true,
                    debug: true,
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60,
                    maxBufferSize: 60 * 1000 * 1000,
                    maxBufferHole: 0.5,
                    backBufferLength: 90
                  });
                  hls.loadSource(hlsStreamUrl);
                  hls.attachMedia(videoRef.current);
                  hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    console.log('HLS manifest parsed for preview');
                    videoRef.current.play();
                  });
                  hls.on(Hls.Events.ERROR, (event, data) => {
                    console.error('HLS error in preview:', data);
                    if (data.fatal) {
                      hls.destroy();
                      setIsStreaming(false);
                    }
                  });
                } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
                  videoRef.current.src = hlsStreamUrl;
                  videoRef.current.play();
                }
              }
            } else {
              console.log('HLS stream not yet available, retrying in 2 seconds...');
              setTimeout(checkHLSStream, 2000);
            }
          } catch (err) {
            console.log('Error checking HLS stream:', err);
            setTimeout(checkHLSStream, 2000);
          }
        };
        
        checkHLSStream();
      }
    } catch (error) {
      console.error('Error starting stream:', error);
      alert('Failed to start streaming: ' + error.message);
      setIsStreaming(false);
    }
  };

  const stopStreaming = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
        streamRef.current = null;
      }

      // Close all peer connections
      peerConnectionsRef.current.forEach((pc) => {
        console.log('Closing peer connection');
        pc.close();
      });
      peerConnectionsRef.current.clear();
      pendingCandidatesRef.current.clear();
      
      setIsStreaming(false);
      console.log('Emitting stop_streaming');
      
      await new Promise((resolve, reject) => {
        socket.emit('stop_streaming', roomId, (response) => {
          if (response?.success) {
            resolve(response);
          } else {
            reject(new Error(response?.error || 'Failed to stop streaming'));
          }
        });
      });

      try {
        const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/delete-room`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId }),
        });
        if (response.ok) {
          console.log(`Room ${roomId} deleted`);
          window.location.href = '/';
        } else {
          console.error('Failed to delete room:', await response.text());
        }
      } catch (err) {
        console.error('Error deleting room:', err);
      }
    } catch (error) {
      console.error('Error stopping stream:', error);
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
      if (socket) {
        try {
          socket.off('webrtc_answer');
          socket.off('webrtc_ice_candidate');
        } catch (err) {
          console.warn('Error during socket cleanup:', err);
        }
      }
    };
  }, [socket]);

  // Update the OBS stream status effect
  useEffect(() => {
    if (!socket) return;

    const cleanup = () => {
      if (socket) {
        try {
          socket.off('stream_status');
        } catch (err) {
          console.warn('Error during socket cleanup:', err);
        }
      }
    };

    socket.on('stream_status', (data) => {
      console.log('Stream status update:', data);
      if (data.isActive) {
        setIsStreaming(true);
      } else {
        setIsStreaming(false);
      }
    });

    return cleanup;
  }, [socket]);

  // Add health monitoring for peer connections
  useEffect(() => {
    if (!isStreaming || streamSource !== 'webcam') {
      return;
    }

    const healthCheckInterval = setInterval(() => {
      const connections = Array.from(peerConnectionsRef.current.entries());
      console.log(`Health check - Managing ${connections.length} peer connections`);
      
      connections.forEach(([viewerId, pc]) => {
        const connectionState = pc.connectionState;
        const iceState = pc.iceConnectionState;
        
        console.log(`Viewer ${viewerId} - Connection: ${connectionState}, ICE: ${iceState}`);
        
        // Check if tracks are still being sent
        const senders = pc.getSenders();
        const activeSenders = senders.filter(sender => 
          sender.track && sender.track.readyState === 'live'
        );
        
        console.log(`Viewer ${viewerId} - Active senders: ${activeSenders.length}/${senders.length}`);
        
        // If connection is failed or closed, clean it up
        if (connectionState === 'failed' || connectionState === 'closed') {
          console.log(`Cleaning up failed connection for viewer ${viewerId}`);
          pc.close();
          peerConnectionsRef.current.delete(viewerId);
          pendingCandidatesRef.current.delete(viewerId);
        }
        
        // If we have no active senders but connection is good, there might be an issue
        if ((connectionState === 'connected' || iceState === 'connected') && activeSenders.length === 0) {
          console.warn(`No active senders for viewer ${viewerId} despite good connection`);
        }
      });
    }, 10000); // Check every 10 seconds

    return () => {
      clearInterval(healthCheckInterval);
    };
  }, [isStreaming, streamSource]);

  if (socketError) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
        <strong className="font-bold">Error: </strong>
        <span className="block sm:inline">{socketError}</span>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        <span className="ml-3">Connecting...</span>
      </div>
    );
  }

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
              <strong>RTMP Server:</strong> {process.env.REACT_APP_RTMP_SERVER}
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