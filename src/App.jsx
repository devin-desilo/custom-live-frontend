import React, { useState, useEffect } from 'react';
import VideoPlayer from './VideoPlayer';
import Broadcaster from './Broadcaster';
import Chat from './Chat';
import Stats from './Stats';
import io from 'socket.io-client';

function App() {
  const [role, setRole] = useState(new URLSearchParams(window.location.search).get('role') || 'viewer');
  const [roomId, setRoomId] = useState(new URLSearchParams(window.location.search).get('room') || '');
  const streamUrl = `${process.env.REACT_APP_HLS_STREAM_URL}/stream_${roomId}.m3u8`; // Dynamic URL based on roomId for stream key
  const [userId, setUserId] = useState(`user_${Math.random().toString(36).substr(2, 9)}`);
  const [username, setUsername] = useState('');
  const [isRoomJoined, setIsRoomJoined] = useState(false);
  const [hostId, setHostId] = useState('');
  const [socket, setSocket] = useState(null);

  // Initialize socket once when component mounts
  useEffect(() => {
    const newSocket = io(process.env.REACT_APP_BACKEND_URL, {
      autoConnect: true,
      forceNew: true,
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setUserId(newSocket.id);
    });

    newSocket.on('stream_ended', (data) => {
      console.log(`Stream ended in room ${data.roomId}. Navigating back to room selection.`);
      setIsRoomJoined(false);
      setRoomId('');
      setRole('viewer');
      window.history.pushState({}, '', '?');
      localStorage.removeItem('role');
      localStorage.removeItem('roomId');
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Generate a random username if not set
  useEffect(() => {
    if (!username) {
      const adjectives = ['Cool', 'Happy', 'Smart', 'Funny', 'Bright', 'Swift', 'Kind', 'Bold', 'Calm', 'Epic'];
      const nouns = ['Viewer', 'User', 'Fan', 'Friend', 'Guest', 'Watcher', 'Star', 'Hero', 'Mate', 'Buddy'];
      const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
      const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
      const randomNumber = Math.floor(Math.random() * 1000);
      setUsername(`${randomAdjective}${randomNoun}${randomNumber}`);
    }
  }, [username]);

  // Handle URL parameters and room restoration
  useEffect(() => {
    if (!socket) return;

    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    const urlRoom = params.get('room');
    // Check local storage for persisted role and room
    const storedRole = localStorage.getItem('role');
    const storedRoom = localStorage.getItem('roomId');
    
    if (urlRole && urlRoom) {
      setRole(urlRole);
      setRoomId(urlRoom);
      if (urlRole === 'host') {
        setIsRoomJoined(true);
        console.log(`Host role detected from URL for room ${urlRoom}. Maintaining host status.`);
      } else {
        joinRoom(urlRoom);
      }
    } else if (storedRole && storedRoom) {
      // If no URL params but stored data exists, use stored data for host
      if (storedRole === 'host') {
        setRole(storedRole);
        setRoomId(storedRoom);
        setIsRoomJoined(true);
        console.log(`Host role restored from local storage for room ${storedRoom}.`);
        // Update URL to reflect persisted state
        window.history.pushState({}, '', `?role=host&room=${storedRoom}`);
      } else {
        // For viewers, clear stored data and reset
        localStorage.removeItem('role');
        localStorage.removeItem('roomId');
      }
    }
  }, [socket]);

  const createRoom = async () => {
    if (!roomId) {
      alert('Please enter a Room ID');
      return;
    }
    if (!socket) {
      alert('Socket not connected');
      return;
    }
    
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/create-room`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomId, hostId: userId }),
      });
      const data = await response.json();
      if (data.message === 'Room created') {
        setIsRoomJoined(true);
        setRole('host');
        window.history.pushState({}, '', `?role=host&room=${roomId}`);
        // No need to emit join-room here - Broadcaster component will handle it
      } else {
        alert(data.message);
      }
    } catch (error) {
      console.error('Error creating room:', error);
      alert('Failed to create room');
    }
  };

  const joinRoom = async (joinRoomId = roomId) => {
    if (!joinRoomId) {
      alert('Please enter a Room ID');
      return;
    }
    if (!socket) {
      alert('Socket not connected');
      return;
    }

    try {
      console.log('Checking room status for:', joinRoomId);
      const roomResponse = await fetch(`${process.env.REACT_APP_BACKEND_URL}/room/${joinRoomId}`);
      const roomData = await roomResponse.json();
      console.log('Room data received:', roomData);

      if (!roomResponse.ok) {
        console.error('Room check failed:', roomData);
        if (roomResponse.status === 404) {
          alert('Room not found. Please check the Room ID or ask the host to create the room first.');
        } else {
          alert('Error checking room status');
        }
        return;
      }

      console.log('Room found, joining as viewer...');
      // Don't check for isStreamActive here - let viewers join and wait for stream
      setIsRoomJoined(true);
      setRoomId(joinRoomId);
      setHostId(roomData.hostId);
      setRole('viewer');
      window.history.pushState({}, '', `?role=viewer&room=${joinRoomId}`);
      // No need to emit join-room here - VideoPlayer component will handle it
      
      if (!roomData.isStreamActive) {
        console.log('Stream not active yet, viewer will wait for stream to start');
      }
    } catch (error) {
      console.error('Error joining room:', error);
      alert('Failed to join room. Please check your connection and try again.');
    }
  };

  const shareUrl = `${window.location.origin}?role=viewer&room=${roomId}`;

  if (!isRoomJoined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">Live Stream Platform</h1>
          <p className="text-gray-600 text-lg">Create or join streaming rooms with real-time chat</p>
        </div>
        
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
          <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Join or Create Room</h2>
          
          <div className="mb-6">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="roomId">
              Room ID
            </label>
            <input
              id="roomId"
              type="text"
              className="shadow appearance-none border rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:shadow-outline focus:border-blue-500 transition-colors"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Enter room ID (e.g., my-stream-123)"
              required
            />
          </div>
          
          <div className="space-y-3">
            <button
              onClick={createRoom}
              className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-lg focus:outline-none focus:shadow-outline transition-colors transform hover:scale-[1.02] active:scale-[0.98]"
            >
              🎥 Create Room (Host)
            </button>
            <button
              onClick={() => joinRoom(roomId)}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg focus:outline-none focus:shadow-outline transition-colors transform hover:scale-[1.02] active:scale-[0.98]"
            >
              👁️ Join Room (Viewer)
            </button>
          </div>
          
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-semibold text-gray-700 mb-2">📋 How it works:</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• <strong>Hosts</strong> can stream using webcam or OBS</li>
              <li>• <strong>Viewers</strong> can join after streaming starts</li>
              <li>• Everyone can chat in real-time</li>
              <li>• Share the room link to invite others</li>
            </ul>
          </div>
          
          <div className="mt-4 text-center">
            <p className="text-xs text-gray-500">
              ⚠️ Note: Viewers can only join after the host starts streaming
            </p>
          </div>
        </div>
        
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500">
            Your username: <span className="font-semibold text-blue-600">{username}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <h1 className="text-3xl font-bold mb-4">Live Stream - Room: {roomId}</h1>
      {role === 'host' ? (
        <Broadcaster roomId={roomId} socket={socket} />
      ) : (
        <VideoPlayer 
          streamUrl={streamUrl} 
          socket={socket}
          roomId={roomId}
          username={username}
          userId={userId}
        />
      )}
      <Chat 
        roomId={roomId} 
        userId={userId} 
        username={username} 
        socket={socket}
      />
      <Stats roomId={roomId} socket={socket} />
      <div className="mt-4 w-full max-w-md">
        <h2 className="text-xl font-bold mb-2">Share Stream</h2>
        <div className="flex items-center">
          <input
            type="text"
            value={shareUrl}
            readOnly
            className="flex-grow p-2 border rounded-l-lg focus:outline-none"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(shareUrl);
              alert('Link copied to clipboard');
            }}
            className="bg-blue-500 text-white p-2 rounded-r-lg hover:bg-blue-700"
          >
            Copy Link
          </button>
        </div>
        <p className="text-sm text-gray-600 mt-1">Role: {role === 'host' ? 'Host' : 'Viewer'}</p>
        <p className="text-sm text-gray-600">Username: {username}</p>
      </div>
    </div>
  );
}

export default App;