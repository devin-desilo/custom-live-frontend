import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

function Stats({ roomId, socket }) {
  const [stats, setStats] = useState({
    connectionStatus: 'Disconnected',
    viewerCount: 0,
    streamQuality: 'Unknown',
    uptime: '00:00:00',
    bytesReceived: 0,
    frameRate: 0,
    resolution: 'Unknown'
  });

  const [startTime] = useState(Date.now());
  const socketRef = React.useRef(socket || io('http://localhost:5000'));

  useEffect(() => {
    const currentSocket = socketRef.current;
    
    if (!currentSocket) return;

    // Connection status monitoring
    const updateConnectionStatus = () => {
      setStats(prev => ({
        ...prev,
        connectionStatus: currentSocket.connected ? 'Connected' : 'Disconnected'
      }));
    };

    // Set up event listeners
    currentSocket.on('connect', updateConnectionStatus);
    currentSocket.on('disconnect', updateConnectionStatus);
    
    currentSocket.on('viewerCount', (count) => {
      setStats(prev => ({ ...prev, viewerCount: count }));
    });

    currentSocket.on('stream_started', (data) => {
      setStats(prev => ({
        ...prev,
        streamQuality: data.source === 'webcam' ? 'WebRTC' : 'HLS',
        connectionStatus: 'Streaming'
      }));
    });

    currentSocket.on('stream_ended', () => {
      setStats(prev => ({
        ...prev,
        streamQuality: 'Offline',
        connectionStatus: 'Connected'
      }));
    });

    // Initial connection status
    updateConnectionStatus();

    // Cleanup
    return () => {
      if (currentSocket) {
        currentSocket.off('connect', updateConnectionStatus);
        currentSocket.off('disconnect', updateConnectionStatus);
        currentSocket.off('viewerCount');
        currentSocket.off('stream_started');
        currentSocket.off('stream_ended');
      }
    };
  }, [roomId]);

  // Update uptime every second
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const hours = Math.floor(elapsed / 3600000);
      const minutes = Math.floor((elapsed % 3600000) / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      
      setStats(prev => ({
        ...prev,
        uptime: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  // Get network information if available
  useEffect(() => {
    if ('connection' in navigator) {
      const updateNetworkInfo = () => {
        const connection = navigator.connection;
        setStats(prev => ({
          ...prev,
          networkType: connection.effectiveType || 'Unknown',
          downlink: connection.downlink || 0
        }));
      };

      updateNetworkInfo();
      navigator.connection.addEventListener('change', updateNetworkInfo);

      return () => {
        navigator.connection.removeEventListener('change', updateNetworkInfo);
      };
    }
  }, []);

  const getStatusColor = (status) => {
    switch (status) {
      case 'Connected': return 'text-green-600';
      case 'Streaming': return 'text-blue-600';
      case 'Disconnected': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Connected': return '🟢';
      case 'Streaming': return '🔴';
      case 'Disconnected': return '⚫';
      default: return '🔸';
    }
  };

  return (
    <div className="mt-4 w-full max-w-md bg-white rounded-lg shadow-md p-4">
      <h2 className="text-xl font-bold mb-3 text-gray-800">📊 Live Stats</h2>
      
      <div className="grid grid-cols-2 gap-4">
        {/* Connection Status */}
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Connection</div>
          <div className={`text-sm font-semibold ${getStatusColor(stats.connectionStatus)}`}>
            {getStatusIcon(stats.connectionStatus)} {stats.connectionStatus}
          </div>
        </div>

        {/* Viewer Count */}
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Viewers</div>
          <div className="text-sm font-semibold text-gray-800">
            👥 {stats.viewerCount}
          </div>
        </div>

        {/* Stream Quality */}
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Stream Type</div>
          <div className="text-sm font-semibold text-gray-800">
            📺 {stats.streamQuality}
          </div>
        </div>

        {/* Uptime */}
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Session Time</div>
          <div className="text-sm font-semibold text-gray-800">
            ⏱️ {stats.uptime}
          </div>
        </div>

        {/* Network Info (if available) */}
        {stats.networkType && (
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">Network</div>
            <div className="text-sm font-semibold text-gray-800">
              📶 {stats.networkType}
            </div>
          </div>
        )}

        {/* Room Info */}
        {roomId && (
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">Room ID</div>
            <div className="text-sm font-semibold text-gray-800 truncate">
              🏠 {roomId}
            </div>
          </div>
        )}
      </div>

      {/* Performance Indicators */}
      <div className="mt-4 pt-3 border-t border-gray-200">
        <div className="flex justify-between items-center text-xs text-gray-500">
          <span>Performance</span>
          <div className="flex space-x-2">
            <span className={`px-2 py-1 rounded ${
              stats.connectionStatus === 'Streaming' ? 'bg-green-100 text-green-600' : 
              stats.connectionStatus === 'Connected' ? 'bg-yellow-100 text-yellow-600' : 
              'bg-red-100 text-red-600'
            }`}>
              {stats.connectionStatus === 'Streaming' ? 'Excellent' : 
               stats.connectionStatus === 'Connected' ? 'Good' : 'Poor'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-3 flex justify-center">
        <button 
          onClick={() => window.location.reload()} 
          className="text-xs text-blue-600 hover:text-blue-800 underline"
        >
          🔄 Refresh Connection
        </button>
      </div>
    </div>
  );
}

export default Stats; 