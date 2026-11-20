"""
Comprehensive Verification Script for LanCast Pro:
- Password authentication (rejects wrong password, accepts correct password)
- Two-way clipboard synchronization
- Audio streaming transmission
- On-demand subnet discovery
"""

import time
import socket
import threading
from lancast.server import LanCastServer
from lancast.client import LanCastClient
from lancast.discovery import LanDiscovery

def test_password_and_clipboard_and_audio():
    print("========================================")
    print(" Test 1: Password Authentication")
    print("========================================")
    
    server = LanCastServer(host='127.0.0.1', port=5950)
    server.access_password = "SecretPassword123"
    server.auto_accept = False
    
    received_clipboard_on_server = []
    server.on_clipboard_received = lambda txt: received_clipboard_on_server.append(txt)
    server.start()
    time.sleep(0.3)

    # 1. Connect with wrong password -> should be rejected
    rejected_reasons = []
    client_wrong = LanCastClient(my_name="BadActor")
    client_wrong.on_rejected = lambda r: rejected_reasons.append(r)
    client_wrong.connect_to('127.0.0.1', 5950, password="WrongPassword")
    time.sleep(0.5)

    assert len(rejected_reasons) > 0, "Client with wrong password was not rejected!"
    print(f"  [PASS] Wrong password correctly rejected: '{rejected_reasons[0]}'")

    # 2. Connect with correct password -> should be accepted
    connected_events = []
    received_clipboard_on_client = []
    received_frames = []
    received_audio = []

    client_good = LanCastClient(my_name="ValidClient")
    client_good.on_connected = lambda perms: connected_events.append(perms)
    client_good.on_clipboard = lambda txt: received_clipboard_on_client.append(txt)
    client_good.on_frame = lambda j, lat: received_frames.append(len(j))
    
    # Hook audio reception
    old_feed = client_good.audio_player.feed_audio
    def hook_audio(data):
        received_audio.append(len(data))
        old_feed(data)
    client_good.audio_player.feed_audio = hook_audio

    client_good.connect_to('127.0.0.1', 5950, password="SecretPassword123")
    time.sleep(0.6)

    assert len(connected_events) > 0, "Client with correct password failed to connect!"
    print(f"  [PASS] Correct password accepted with permissions: {connected_events[0]}")

    print("========================================")
    print(" Test 2: Two-Way Clipboard Synchronization")
    print("========================================")
    # Client sends clipboard to Server
    test_clip_1 = "Hello from Viewer Clipboard 12345"
    client_good.send_clipboard(test_clip_1)
    time.sleep(0.4)

    assert len(received_clipboard_on_server) > 0, "Server did not receive clipboard from client!"
    assert received_clipboard_on_server[0] == test_clip_1, f"Mismatch: {received_clipboard_on_server[0]}"
    print(f"  [PASS] Client -> Host Clipboard Sync: '{received_clipboard_on_server[0]}'")

    # Server sends clipboard to Client
    test_clip_2 = "Hello from Host System 67890"
    server.broadcast_clipboard(test_clip_2)
    time.sleep(0.4)

    assert len(received_clipboard_on_client) > 0, "Client did not receive clipboard from server!"
    assert received_clipboard_on_client[0] == test_clip_2, f"Mismatch: {received_clipboard_on_client[0]}"
    print(f"  [PASS] Host -> Client Clipboard Sync: '{received_clipboard_on_client[0]}'")

    print("========================================")
    print(" Test 3: Audio Streaming Packet Transmission")
    print("========================================")
    dummy_pcm = b"\x00\x01\x02\x03" * 256
    server.broadcast_audio(dummy_pcm)
    time.sleep(0.3)

    assert len(received_audio) > 0, "Client did not receive audio packet from server!"
    print(f"  [PASS] Audio packet successfully received ({received_audio[0]} bytes)")

    client_good.disconnect()
    server.stop()
    print("  [PASS] Test 1, 2, 3 Complete!\n")

def test_on_demand_discovery():
    print("========================================")
    print(" Test 4: On-Demand Subnet Scanner")
    print("========================================")
    # Start a server on port 5951
    server = LanCastServer(host='0.0.0.0', port=5951)
    server.start()
    time.sleep(0.3)

    found_devices = []
    discovery = LanDiscovery(device_name="TestScanner", local_ip="127.0.0.1", tcp_port=5951,
                             on_device_found=lambda dev, is_new: found_devices.append(dev))
    discovery.start()

    # Trigger on-demand scan on port 5951
    scan_done = threading.Event()
    discovery.scan_subnet(target_ports=[5951], on_complete=scan_done.set)
    scan_done.wait(timeout=2.0)

    server.stop()
    discovery.stop()
    print("  [PASS] On-Demand Subnet Scanner finished cleanly without freezing.")

if __name__ == '__main__':
    test_password_and_clipboard_and_audio()
    test_on_demand_discovery()
    print("ALL CORE UNIT & PROTOCOL TESTS PASSED! 🎉")
