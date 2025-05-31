import React, { useState, useEffect } from 'react';
import VideoPlayer from './VideoPlayer';
import Broadcaster from './Broadcaster';
import Chat from './Chat';
import Stats from './Stats';
import io from 'socket.io-client';

const socket = io('http://localhost:5000');

function App() {
  const [role, setRole] = useState(new URLSearchParams(window.location.search).get('role') || 'viewer');
  const [roomId, setRoomId] = useState(new URLSearchParams(window.location.search).get('room') || '');
  const streamUrl = `http://localhost:8080/hls/stream_${roomId}.m3u8`; // Dynamic URL based on roomId for stream key
  const [userId, setUserId] = useState(`user_${Math.random().toString(36).substr(2, 9)}`);
  const [isRoomJoined, setIsRoomJoined] = useState(false);
  const [hostId, setHostId] = useState('');

  useEffect(() => {
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
        // Rejoin as host without creating a new room
        socket.emit('join-room', { roomId: urlRoom, userId });
        // Persist in local storage
        // localStorage.setItem('role', urlRole);
        // localStorage.setItem('roomId', urlRoom);
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
        socket.emit('join-room', { roomId: storedRoom, userId });
        // Update URL to reflect persisted state
        window.history.pushState({}, '', `?role=host&room=${storedRoom}`);
      } else {
        // For viewers, clear stored data and reset
        localStorage.removeItem('role');
        localStorage.removeItem('roomId');
      }
    }

    socket.on('connect', () => {
      setUserId(socket.id);
    });

    socket.on('stream_ended', (data) => {
      console.log(`Stream ended in room ${data.roomId}. Navigating back to room selection.`);
      setIsRoomJoined(false);
      setRoomId('');
      setRole('viewer');
      window.history.pushState({}, '', '?');
      localStorage.removeItem('role');
      localStorage.removeItem('roomId');
      alert('The host has ended the stream. You have been navigated back to the room selection screen.');
    });

    return () => {
      socket.off('connect');
      socket.off('stream_ended');
    };
  }, []);

  const createRoom = async () => {
    if (!roomId) {
      alert('Please enter a Room ID');
      return;
    }
    try {
      const response = await fetch('http://localhost:5000/create-room', {
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
        socket.emit('join-room', { roomId, userId });
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
    try {
      const response = await fetch('http://localhost:5000/join-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomId: joinRoomId, userId }),
      });
      const data = await response.json();
      if (data.message === 'Joined room') {
        setIsRoomJoined(true);
        setRoomId(joinRoomId);
        setHostId(data.hostId);
        setRole('viewer');
        window.history.pushState({}, '', `?role=viewer&room=${joinRoomId}`);
        socket.emit('join-room', { roomId: joinRoomId, userId });
      } else {
        alert(data.message);
      }
    } catch (error) {
      console.error('Error joining room:', error);
      alert('Failed to join room');
    }
  };

  const shareUrl = `${window.location.origin}?role=viewer&room=${roomId}`;

  if (!isRoomJoined) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
        <h1 className="text-3xl font-bold mb-4">Live Stream Room</h1>
        <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
          <h2 className="text-2xl font-bold mb-4">Join or Create Room</h2>
          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="roomId">
              Room ID
            </label>
            <input
              id="roomId"
              type="text"
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-between">
            <button
              onClick={createRoom}
              className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
            >
              Create Room (Host)
            </button>
            <button
              onClick={() => joinRoom(roomId)}
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
            >
              Join Room (Viewer)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <h1 className="text-3xl font-bold mb-4">Live Stream - Room: {roomId}</h1>
      {role === 'host' ? <Broadcaster roomId={roomId} /> : <VideoPlayer streamUrl={streamUrl} />}
      <Chat />
      <Stats />
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
      </div>
    </div>
  );
}

export default App;