#!/usr/bin/env python3
"""
scripts/wake-detector.py

Persistent TCP server for wake word detection.
Expects raw PCM16 16kHz stream from a client (e.g. Node bridge).
Sends back JSONL events when a wake word is detected.
"""

import argparse
import socket
import json
import logging
import numpy as np
import os
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

try:
    import openwakeword
    from openwakeword.model import Model
except ImportError:
    logging.error("openwakeword not installed. Please run: pip install openwakeword")
    exit(1)

def main():
    parser = argparse.ArgumentParser(description="Hermes Wake Word TCP Server")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="TCP Host")
    parser.add_argument("--port", type=int, default=8766, help="TCP Port")
    parser.add_argument("--model", type=str, default="hey_jarvis", help="Wake word model name or path")
    parser.add_argument("--threshold", type=float, default=0.5, help="Wake word trigger threshold")
    
    args = parser.parse_args()

    # Verify if model exists or is predefined
    pretrained_models = openwakeword.get_pretrained_model_paths("onnx")
    
    # Try to find the actual file path
    actual_model_path = None
    if os.path.exists(args.model):
        actual_model_path = args.model
    else:
        for p in pretrained_models:
            basename = os.path.basename(p).replace(".onnx", "").replace("_v0.1", "")
            if basename == args.model or os.path.basename(p) == args.model:
                if os.path.exists(p):
                    actual_model_path = p
                break
    
    if not actual_model_path:
        logging.error(f"Model '{args.model}' not found in pre-trained models or local paths.")
        logging.error("Did you run download_models()?")
        sys.exit(1)

    # Initialize openWakeWord Model
    logging.info(f"Loading openWakeWord model from: {actual_model_path}")
    try:
        oww_model = Model(wakeword_models=[actual_model_path], inference_framework="onnx")
    except Exception as e:
        logging.error(f"Failed to load openWakeWord model: {e}")
        sys.exit(1)

    # For openwakeword, internal state accumulates.
    # Predict is called with chunks. Standard chunk is 1280 samples (2560 bytes).
    FRAME_SAMPLES = 1280
    FRAME_BYTES = FRAME_SAMPLES * 2

    # Start TCP Server
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind((args.host, args.port))
    server_socket.listen(1)
    
    logging.info(f"Wake detector listening on tcp://{args.host}:{args.port}")

    while True:
        try:
            client, addr = server_socket.accept()
            logging.info(f"Client connected from {addr}")
            
            # Reset model state for a new connection to prevent false triggers from previous audio
            oww_model.reset()
            buffer = bytearray()

            # Send ready event immediately
            try:
                ready_event = {
                    "event": "ready",
                    "model": args.model,
                    "threshold": args.threshold
                }
                client.sendall((json.dumps(ready_event) + "\n").encode('utf-8'))
            except Exception as e:
                logging.error(f"Failed to send ready event: {e}")
                continue
            
            while True:
                data = client.recv(4096)
                if not data:
                    logging.info("Client disconnected.")
                    break
                
                buffer.extend(data)
                
                # Process all complete chunks in the buffer
                while len(buffer) >= FRAME_BYTES:
                    frame_bytes = bytes(buffer[:FRAME_BYTES])
                    del buffer[:FRAME_BYTES]
                    
                    # Convert bytes to int16 numpy array
                    pcm = np.frombuffer(frame_bytes, dtype="<i2")
                    
                    # Run inference
                    prediction = oww_model.predict(pcm)
                    
                    # Check scores
                    for mdl, score in prediction.items():
                        # Emit score event for diagnostics if score > 0.05
                        if score > 0.05:
                            score_event = {
                                "event": "score",
                                "keyword": mdl,
                                "score": float(score)
                            }
                            try:
                                client.sendall((json.dumps(score_event) + "\n").encode('utf-8'))
                            except BrokenPipeError:
                                break

                        if score >= args.threshold:
                            # Send JSONL wake event
                            import time
                            event = {
                                "event": "wake",
                                "keyword": mdl,
                                "score": float(score),
                                "timestamp": int(time.time() * 1000)
                            }
                            try:
                                client.sendall((json.dumps(event) + "\n").encode('utf-8'))
                                logging.info(f"Wake word detected! model={mdl} score={score:.3f}")
                                # Reset model state to avoid continuous triggering
                                oww_model.reset()
                            except BrokenPipeError:
                                break
        except KeyboardInterrupt:
            logging.info("Shutting down...")
            break
        except Exception as e:
            logging.error(f"Error handling connection: {e}")
        finally:
            if 'client' in locals() and client:
                client.close()

    server_socket.close()

if __name__ == "__main__":
    main()
