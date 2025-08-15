# Saren's Cantonese LLM Voice Assistant config for Home Assistant v0.0.3
Transform your Cantonese-speaking Hong Kong home to use LLMs in Home Assistant without language barriers.

See it in action: https://www.youtube.com/watch?v=AsE5OYmnYws

# What to Expect
- Natural Cantonese Conversation with AI with fairly good UX. Capable of controlling most of your IoT devices without scripting.
- Abusing HA's `todo` as AI's Persistent Memory.
- Tool calling via custom Node.js APIs for advanced integrations without touching HA's DSL.
  - Fetching KMB ETAs.
  - Fetching HKO's weather RSS, including radar images. Radar images will be analyzed by calling a SOTA multimodal LLM.
- LLMs capable of reading YAML documentation before setting up automation.
- ~0.15s Speech-To-Text (STT) time for common voice commands using Intel 13900H's iGPU.

# Caveats
- While mostly intelligent (人工智能), it can sometimes be unintelligent (人工智障). Be patient and try to speak as clearly as possible (both pronunciation and communication).
- For now: No "remind me in 5 minutes." No internet search. No playing music or video.

# Changelog

## 0.0.3
1. Moved from whisper to sensevoice, Memory requirement 16GB => 4GB (usage 12GB => 700MB).
2. Added TTS interrupt support if your device supports echo cancellation. See `main-ha.js` line 19.
3. Changed system prompt and patched `extended_openai_conversation` `__init__.py`
    - Increased KV cache efficiency. 
    - Provided `Qwen-Qwen3-30B-A3B-Instruct-2507-KV-Optimized.jinja` prompt template for use in (ik_)llama.cpp with `Qwen3-30B-A3B-Instruct-2507` to further increase KV cache efficiency.
    - Supports the half baked tool_call of (ik_)llama.cpp
4. Recommended model: GLM 4.5 (Provider: z.ai, because of low latency and use of cache)
5. By default UI when it's local time 22pm - 7am, and volume will be lower when it's 22pm - 8am.

# Future Plan
- Support LLM=>TTS streaming to further reduce latency
- Buy a PC to self host GLM 4.5

# Requirements
- 4GB RAM
- Any modern tablet PC/Android with a Chrome browser, preferably with echo cancellation.
- Home Assistant with **HACS (Home Assistant Community Store)** is recommended for managing custom frontend components, as the paths provided assume its structure.
- Docker with **`docker-compose`** (Typically included with Docker Desktop, but may be a separate install on Linux)
- OpenRouter API key for LLMs (or Local LLMs [llama.cpp/ollama] if your hardware is sufficiently powerful).
- Some programming knowledge to modify the configuration with correct syntax.

# Installation and Setup
1. Clone this repo and cd `home-assistant-cantonese-llm-voice-assistant`.

2. Go to `sensevoice-docker`. This is the Speech-To-Text core.
    1. Run `docker-compose up -d`.
    2. Add wyoming protocol integration with host `localhost` and port `7892`

3. Go to `extended_openai_conversation`. This is the LLM interaction core.
    1. Read `extended_openai_conversation/README.md` to set up the core plugin.
    2. Setup Voice Assistant

4. Set up `jarvis`. This is the core UI that integrates in-browser wake word + voice activity detection (VAD) and invokes the HA Voice Assistant pipeline.
    1. Go to `/profile/security` of your HA instance and create a permanent token. Edit line 7 of `main-ha.js` and replace it with `let token = '...';`. Alternatively, you can append ?token=XXX&pipeline_name=YYY to HA's dashboard URL to set parameters.
    2. Edit line 9 of `main-ha.js` for the pipeline name. To find the pipeline name, open the web inspector, inspect `/websocket`, and click Voice Assistant in HA. ![asd](https://drop.wtako.net/file/bf7026d94abe23bc8b90d7a146d31bcbf62cee35.png)
    3. The dashboard must include `-samsung` to activate jarvis. To change this, edit line 834.
    4. Copy the `jarvis` folder into HA's `config/www/community/jarvis`.
    5. Go to `/config/lovelace/resources` of your HA instance; add `/hacsfiles/jarvis/voice-loader.js?a=1` as a Javascript module.
    6. If your device supports echo cancellation, it's recommended to set `const CAN_INTERRUPT = true;` at line 19 so that you can interrupt the TTS by speaking.

5. Set up `llm-api`. This provides the (example) external interface for the LLM to fetch data or syntax documentation from the internet. Think of a low-grade MCP server.
    1. Go to `llm-api`.
    2. If you want HKO Radar analysis, edit `docker-compose.yml` to provide your own OpenRouter API key and Telegram bot details. Otherwise, remove the related API from `apis.json`.
    3. Edit `apis.json` and `kmb/index.js` so that the bus stations are relevant to your home and workplace, not mine. No changes are needed if you live at KAM TAI COURT and work near TST HAIPHONG ROAD.
    4. Run `docker-compose up -d`.

# Usage
1. Create a dashboard whose name includes `samsung` or other name you changed earlier setting up `jarvis`.
2. Allow microphone access to the web page.
3. Input token and pipeline name as mentioned in `jarvis` setup.
4. Say "**Hey Siri**" to activate the UI. It must be in English, and it must be "Hey Siri." It has the highest success rate and has never misfired for me. Change line 500 of `jarvis/main-ha.js` if you prefer otherwise.
5. Say "bumblebee" to reset the LLM context. 
6. If UI is activated:
    - Say "重新整理" to reload both the UI and LLM context.
    - Say "細聲d/大聲d/將音量設為50%" to set the volume of sounds and voices.
    - Say "冇你既事/你可以走啦" or anything dismissive to close the UI.
    - Ask questions about your home, bus ETAs, weather, etc. You can also tell the LLM to create automation or other tasks.
    - Ask LLM to search internet, for news, stock prices, new events, travel information...
    - It is not recommended to say "**Hey Siri**." when TTS is speaking. The states will mess up and it's untested.
    - If your device supports echo cancellation, and if you set `const CAN_INTERRUPT = true;` at line 19, you can interrupt the TTS by speaking.

# Licenses
- llm-api: GPLv3
- jarvis (main-ha.js and voice-loader.js): GPLv3
- System Prompts and Function list: CC0
- Other components has their own corresponding authors and licenses. (jaxcore/bumblebee-hotword, ricky0123/vad, etc)
