"""
LanCast LAN Device Discovery
Lightweight UDP broadcast beacon and on-demand parallel TCP subnet scanner.
Conserves CPU and network resources by scanning only when requested by the user.
"""

import socket
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

UDP_DISCOVERY_PORT = 5857

class LanDiscovery:
    def __init__(self, device_name: str, local_ip: str, tcp_port: int = 5858, on_device_found=None):
        self.device_name = device_name
        self.local_ip = local_ip
        self.tcp_port = tcp_port
        self.on_device_found = on_device_found
        
        self.running = False
        self.is_scanning = False
        self.discovered_devices = {}  # "ip:port" -> dict
        self._lock = threading.Lock()
        self._threads = []

    def start(self):
        self.running = True
        t1 = threading.Thread(target=self._broadcast_loop, daemon=True)
        t2 = threading.Thread(target=self._listen_loop, daemon=True)
        t3 = threading.Thread(target=self._clean_loop, daemon=True)

        self._threads = [t1, t2, t3]
        for t in self._threads:
            t.start()

    def stop(self):
        self.running = False

    def _broadcast_loop(self):
        """Periodically broadcast UDP beacon to advertise presence on local network."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(1.0)

        payload = json.dumps({
            "service": "lancast",
            "name": self.device_name,
            "ip": self.local_ip,
            "port": self.tcp_port
        }).encode('utf-8')

        while self.running:
            try:
                sock.sendto(payload, ('255.255.255.255', UDP_DISCOVERY_PORT))
            except Exception:
                pass
            time.sleep(3.0)

        sock.close()

    def _listen_loop(self):
        """Listen for UDP discovery beacons from other LanCast devices on the subnet."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(('0.0.0.0', UDP_DISCOVERY_PORT))
        except Exception:
            return

        sock.settimeout(1.0)

        while self.running:
            try:
                data, addr = sock.recvfrom(4096)
                msg = json.loads(data.decode('utf-8'))
                if msg.get("service") == "lancast":
                    peer_ip = msg.get("ip") or addr[0]
                    peer_port = int(msg.get("port", 5858))
                    
                    if peer_ip == self.local_ip or peer_ip.startswith("127."):
                        continue
                    
                    self._register_device(
                        ip=peer_ip,
                        name=msg.get("name", f"Device-{peer_ip}"),
                        port=peer_port
                    )
            except (socket.timeout, json.JSONDecodeError):
                continue
            except Exception:
                pass

        sock.close()

    def scan_subnet(self, target_ports=None, on_complete=None):
        """On-demand parallel TCP subnet scan across target ports."""
        if self.is_scanning:
            return
        
        if target_ports is None:
            target_ports = [self.tcp_port, 5858, 5859]
        # Remove duplicates while preserving order
        target_ports = list(dict.fromkeys(target_ports))

        def _worker():
            self.is_scanning = True
            try:
                if self.local_ip and self.local_ip != '127.0.0.1':
                    prefix = self.local_ip.rsplit('.', 1)[0]
                    my_last = int(self.local_ip.rsplit('.', 1)[1])
                    
                    # Scan full /24 subnet or nearby cluster
                    targets = []
                    # Check common nearby IP offsets first, then rest of subnet
                    nearby = []
                    for offset in range(-30, 31):
                        oct_val = my_last + offset
                        if 1 <= oct_val <= 254 and oct_val != my_last:
                            nearby.append(oct_val)

                    remaining = [i for i in range(1, 255) if i != my_last and i not in nearby]
                    all_octets = nearby + remaining

                    for oct_val in all_octets:
                        ip = f"{prefix}.{oct_val}"
                        for p in target_ports:
                            targets.append((ip, p))

                    with ThreadPoolExecutor(max_workers=60) as executor:
                        futures = [executor.submit(self._probe_peer, ip, port) for ip, port in targets]
                        for f in futures:
                            if not self.running:
                                break
            finally:
                self.is_scanning = False
                if on_complete:
                    on_complete()

        threading.Thread(target=_worker, daemon=True).start()

    def _probe_peer(self, ip: str, port: int):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.35)  # reliable check over Wi-Fi (350ms)
            res = s.connect_ex((ip, port))
            s.close()
            if res == 0:
                self._register_device(ip=ip, name=f"Host-{ip}", port=port)
        except Exception:
            pass

    def _register_device(self, ip: str, name: str, port: int):
        if not ip or ip == self.local_ip or ip.startswith("127.") or ip == "localhost":
            return
        dev_id = ip
        dev = {
            "name": name,
            "ip": ip,
            "port": port,
            "last_seen": time.time()
        }
        with self._lock:
            if dev_id in self.discovered_devices:
                self.discovered_devices[dev_id]["last_seen"] = time.time()
                return
            self.discovered_devices[dev_id] = dev

        if self.on_device_found:
            self.on_device_found(dev, True)

    def _clean_loop(self):
        """Prunes dead devices after 25 seconds of silence."""
        while self.running:
            time.sleep(5.0)
            now = time.time()
            with self._lock:
                expired = [k for k, v in self.discovered_devices.items() if now - v["last_seen"] > 25.0]
                for k in expired:
                    del self.discovered_devices[k]

    def get_devices(self):
        with self._lock:
            return list(self.discovered_devices.values())
