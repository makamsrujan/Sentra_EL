# WM8960 and headset acceptance

Buy the standalone Waveshare WM8960 Audio Board and a compatible single-ear
TRRS microphone headset. Do not substitute the Raspberry Pi WM8960 Audio HAT
without redesigning the connection.

1. Confirm the standalone module's exact supply, I²C/I²S labels and jack pin order.
2. Verify CTIA/OMTP headset microphone contacts; use a compatible adapter if needed.
3. Verify the codec responds to I²C configuration; this is not proof of sound.
4. Play a quiet WAV test tone through the earphone at conservative gain.
5. Record a short utterance and inspect actual PCM amplitude and quality.
6. Upload a valid 16 kHz mono PCM16 WAV via authenticated audio endpoint.
7. Verify STT response; generate and retrieve a fresh TTS WAV and play it once.
8. Test cancellation and avoidance of self-triggered wake detection.
9. Confirm safe volume and keep an ear open to environmental sounds.

**Present firmware activation is button-based.** Hands-free wake-word
and local ToF warning playback require additional implementation/validation.
