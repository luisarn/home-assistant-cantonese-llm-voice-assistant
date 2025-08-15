"""Event handler for clients of the server."""
import argparse
import json
import logging
import struct
import websockets
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioChunk, AudioChunkConverter, AudioStop
from wyoming.event import Event
from wyoming.info import Describe, Info
from wyoming.server import AsyncEventHandler

_LOGGER = logging.getLogger(__name__)


class WhisperAPIEventHandler(AsyncEventHandler):
    """Event handler for clients."""

    def __init__(
        self,
        wyoming_info: Info,
        cli_args: argparse.Namespace,
        *args,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)

        self.cli_args = cli_args
        self.wyoming_info_event = wyoming_info.event()
        self.audio = bytes()
        self.audio_converter = AudioChunkConverter(
            rate=16000,
            width=2,
            channels=1,
        )

    async def handle_event(self, event: Event) -> bool:
        if Describe.is_type(event.type):
            await self.write_event(self.wyoming_info_event)
            _LOGGER.debug("Sent info")
            return True

        if Transcribe.is_type(event.type):
            _LOGGER.debug("Transcribe event")
            try:
                _LOGGER.debug(f"Connecting to websocket: {self.cli_args.api}")
                self.websocket = await websockets.connect(self.cli_args.api)
                self.audio = bytes()
            except Exception:
                _LOGGER.exception("Failed to connect to websocket")
                await self.write_event(
                    Transcript(text="(Speech to text failed: connection error)").event()
                )
                return False  # stop processing
            return True

        if AudioChunk.is_type(event.type):
            if not self.audio:
                _LOGGER.debug("Receiving audio")

            chunk = AudioChunk.from_event(event)
            chunk = self.audio_converter.convert(chunk)
            self.audio += chunk.audio

            return True

        if AudioStop.is_type(event.type):
            _LOGGER.debug("Audio stopped")
            # try:
            #     import os
            #     import time
            #     import wave

            #     debug_dir = "/debug"
            #     os.makedirs(debug_dir, exist_ok=True)
            #     timestamp = time.strftime("%Y%m%d-%H%M%S")
            #     wav_path = os.path.join(debug_dir, f"{timestamp}.wav")

            #     with wave.open(wav_path, "wb") as wav_file:
            #         wav_file.setnchannels(self.audio_converter.channels)
            #         wav_file.setsampwidth(self.audio_converter.width)
            #         wav_file.setframerate(self.audio_converter.rate)
            #         wav_file.writeframes(self.audio)
            #     _LOGGER.debug("Saved debug audio to %s", wav_path)
            # except Exception:
            #     _LOGGER.exception("Failed to save debug audio")

            text = "(Speech To Text failed)"
            try:
                if self.websocket is None:
                    raise ConnectionError(
                        "WebSocket not connected. Did a Transcribe event come first?"
                    )

                # Convert 16-bit signed integer PCM to 32-bit float
                num_samples = len(self.audio) // 2
                samples_int16 = struct.unpack(f"<{num_samples}h", self.audio)
                samples_float32 = [s / 32767.0 for s in samples_int16]
                audio_float32 = struct.pack(f"<{num_samples}f", *samples_float32)

                # Send header: 4-byte sample rate (16000), 4-byte number of bytes
                header = struct.pack("<ii", 16000, len(audio_float32))
                await self.websocket.send(header)

                # Send audio data in chunks
                n = 4096
                for i in range(0, len(audio_float32), n):
                    await self.websocket.send(audio_float32[i : i + n])

                # Receive transcription result
                response_str = await self.websocket.recv()
                text = response_str.strip()
                _LOGGER.debug(f"Received: {text}")

                await self.websocket.send("Done")

            except Exception as e:
                _LOGGER.error(repr(e))
                _LOGGER.error("Speech To Text failed: %s", e)
            finally:
                if self.websocket is not None:
                    await self.websocket.close()
                    self.websocket = None

            await self.write_event(Transcript(text=text).event())
            _LOGGER.debug("Completed request")

            return False

        return True
