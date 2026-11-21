# [LEGACY] WM8960 and TRRS Headset Acceptance

> **LEGACY NOTICE:** The actual hardware inventory uses discrete **INMP441 + MAX98357A** (not a WM8960 codec). This file is retained strictly for legacy reference. For actual hardware audio bring-up, see [`audio-bench-test.md`](audio-bench-test.md).

`CONFIG_SENTRA_ENABLE_WM8960` remains disabled (`n`) by default and is mutually exclusive with `CONFIG_SENTRA_ENABLE_AUDIO_I2S_DISCRETE`.

If a standalone Waveshare WM8960 Audio Board is ever re-introduced:
1. Confirm exact supply, I²C/I²S labels, and CTIA/OMTP TRRS pin order.
2. Verify codec I²C ACK, quiet test tone playback, and 16 kHz mono PCM16 WAV capture.
3. Confirm safe volume and avoid self-triggered wake detection.
