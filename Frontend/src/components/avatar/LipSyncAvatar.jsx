import React, { useEffect, useRef, useState } from 'react';
import { createLipSyncAvatar } from '../../services/lipsync/index.js';

/**
 * LipSyncAvatar
 * Embedded client-side animated avatar with real-time lip sync and natural eye blinking.
 * Powered by HTML5 Canvas and the Web Audio API.
 *
 * @param {Object} props
 * @param {'female'|'male'} [props.character='female'] - Character avatar pack ('female' or 'male')
 * @param {boolean} [props.isSpeaking=false] - Whether the avatar is currently speaking (e.g. Web Speech or voice response)
 * @param {HTMLAudioElement} [props.audioElement=null] - Active audio element to analyze for real-time lip-sync
 * @param {number} [props.size=160] - Diameter / dimension of the circular avatar canvas in CSS pixels
 * @param {string} [props.className=''] - Additional CSS classes
 * @param {() => void} [props.onClick] - Optional click handler (e.g. to call avatar or toggle listening)
 */
export function LipSyncAvatar({
  character = 'female',
  isSpeaking = false,
  audioElement = null,
  size = 160,
  className = '',
  onClick
}) {
  const canvasRef = useRef(null);
  const playerRef = useRef(null);
  const [loadError, setLoadError] = useState(false);
  const isSpeakingRef = useRef(isSpeaking);
  isSpeakingRef.current = isSpeaking;

  const charFolder = character === 'male' ? 'male' : 'female';
  const assetsUrl = `/avatars/${charFolder}`;

  useEffect(() => {
    let isCancelled = false;
    let playerInstance = null;

    if (!canvasRef.current) return;

    const canvas = canvasRef.current;

    // Detect active audio source (prop or global neural stream)
    const activeAudio = audioElement || (typeof window !== 'undefined' ? window._skillbridgeCurrentAudio : null);

    createLipSyncAvatar(canvas, {
      assetsUrl,
      configUrl: '/config/lipsync.config.json',
      source: activeAudio,
      headMotion: true,
      getIsSpeaking: () => isSpeakingRef.current,
    })
      .then((instance) => {
        if (isCancelled) {
          instance.destroy();
          return;
        }
        playerInstance = instance;
        playerRef.current = instance;
        setLoadError(false);
      })
      .catch((err) => {
        console.warn('[LipSyncAvatar] Failed to initialize animated avatar pack:', err.message);
        if (!isCancelled) setLoadError(true);
      });

    return () => {
      isCancelled = true;
      if (playerInstance) {
        playerInstance.destroy();
      }
      playerRef.current = null;
    };
  }, [charFolder]);

  // Keep audio source dynamically synced whenever window._skillbridgeCurrentAudio changes
  useEffect(() => {
    const checkAudioSource = () => {
      const currentAudio = audioElement || (typeof window !== 'undefined' ? window._skillbridgeCurrentAudio : null);
      if (playerRef.current && currentAudio) {
        try {
          playerRef.current.setSource(currentAudio);
        } catch (_) {}
      }
    };

    checkAudioSource();
    const interval = setInterval(checkAudioSource, 800);
    return () => clearInterval(interval);
  }, [audioElement]);

  if (loadError) {
    return (
      <div
        onClick={onClick}
        className={`relative rounded-full overflow-hidden flex items-center justify-center bg-slate-900 select-none ${className}`}
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        <img
          src={`/avatars/${charFolder}/base.png`}
          alt="AI Tutor Avatar"
          className="w-full h-full object-cover rounded-full"
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`relative rounded-full overflow-hidden flex items-center justify-center select-none ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <canvas
        ref={canvasRef}
        width={size * 2}
        height={size * 2}
        role="img"
        aria-label="Animated AI Tutor with real-time lip-sync and eye blinking"
        className="w-full h-full object-cover rounded-full pointer-events-none"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          display: 'block',
          borderRadius: '50%'
        }}
      />
    </div>
  );
}

export default LipSyncAvatar;
