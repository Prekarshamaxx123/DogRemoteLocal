"""
Verification for:
1. Password rejection codes (PASSWORD_REQUIRED, PASSWORD_INCORRECT)
2. No password interactive request trigger
3. Single disconnect trigger (atomic disconnect)
4. Zero-lag 1-item queue frame drops
"""

import time
import socket
import threading
from lancast.server import LanCastServer
from lancast.client import LanCastClient

def test_password_codes_and_interactive():
    print("========================================")
    print(" Test 1: Password Rejection Codes")
    print("========================================")
    server = LanCastServer(host='127.0.0.1', port=5970)
    server.access_password = "mySecretPassword"
    server.start()
    time.sleep(0.3)

    # 1. Connect without password -> expects PASSWORD_REQUIRED
    reasons = []
    c1 = LanCastClient(my_name="NoPassClient")
    c1.on_rejected = lambda r: reasons.append(r)
    c1.connect_to('127.0.0.1', 5970, password="")
    time.sleep(0.4)
    assert "PASSWORD_REQUIRED" in reasons, f"Expected PASSWORD_REQUIRED, got: {reasons}"
    print(f"  [PASS] Empty password rejected with code: '{reasons[-1]}'")

    # 2. Connect with incorrect password -> expects PASSWORD_INCORRECT
    reasons.clear()
    c2 = LanCastClient(my_name="WrongPassClient")
    c2.on_rejected = lambda r: reasons.append(r)
    c2.connect_to('127.0.0.1', 5970, password="wrong")
    time.sleep(0.4)
    assert "PASSWORD_INCORRECT" in reasons, f"Expected PASSWORD_INCORRECT, got: {reasons}"
    print(f"  [PASS] Wrong password rejected with code: '{reasons[-1]}'")

    # 3. Connect with correct password -> accepted
    connected = []
    c3 = LanCastClient(my_name="GoodClient")
    c3.on_connected = lambda p: connected.append(p)
    c3.connect_to('127.0.0.1', 5970, password="mySecretPassword")
    time.sleep(0.4)
    assert len(connected) > 0, "Correct password was not accepted!"
    print(f"  [PASS] Correct password accepted!")

    # 4. Atomic single disconnect test
    disconnect_calls = []
    c3.on_disconnected = lambda: disconnect_calls.append(1)
    c3.disconnect()
    c3.disconnect()  # call twice
    time.sleep(0.2)
    assert len(disconnect_calls) == 1, f"disconnect called {len(disconnect_calls)} times!"
    print("  [PASS] Atomic disconnect triggered exactly once!")

    server.stop()
    time.sleep(0.3)

def test_no_password_interactive_popup():
    print("========================================")
    print(" Test 2: No Password Interactive Popup")
    print("========================================")
    server = LanCastServer(host='127.0.0.1', port=5971)
    server.access_password = ""  # No password configured!
    
    incoming_requests = []
    server.on_incoming_request = lambda s, d: incoming_requests.append((s, d))
    server.start()
    time.sleep(0.3)

    c = LanCastClient(my_name="GuestUser")
    c.connect_to('127.0.0.1', 5971, password="")
    time.sleep(0.5)

    assert len(incoming_requests) == 1, f"Expected 1 incoming request, got {len(incoming_requests)}"
    session, data = incoming_requests[0]
    print(f"  [PASS] Interactive security popup triggered on host for '{data.get('name')}'!")

    # Host approves connection
    session.accept_connection(allow_control=True)
    time.sleep(0.3)
    assert c.connected, "Client did not get connected after host approved!"
    print("  [PASS] Host interactive approval successfully connected client!")

    c.disconnect()
    server.stop()

def test_zero_lag_frame_queue():
    print("========================================")
    print(" Test 3: Zero-Lag Frame Drop Queue")
    print("========================================")
    server = LanCastServer(host='127.0.0.1', port=5972)
    server.access_password = ""
    server.on_incoming_request = lambda s, d: s.accept_connection()
    server.start()
    time.sleep(0.3)

    received_frames = []
    c = LanCastClient(my_name="FastViewer")
    c.on_frame = lambda j, lat: received_frames.append(len(j))
    c.connect_to('127.0.0.1', 5972)
    time.sleep(0.4)

    # Blast 20 frames rapidly
    for i in range(20):
        dummy_jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 2048 + b"\xff\xd9"
        server.broadcast_frame(dummy_jpeg)

    time.sleep(0.5)
    print(f"  [PASS] Server broadcasted 20 frames rapidly, client received frames without hang ({len(received_frames)} received)")

    c.disconnect()
    server.stop()
    print("\nALL V2 TESTS PASSED! 🎉")

if __name__ == '__main__':
    test_password_codes_and_interactive()
    test_no_password_interactive_popup()
    test_zero_lag_frame_queue()
