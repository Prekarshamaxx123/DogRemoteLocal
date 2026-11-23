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
    def __init__(self, device_name: str, local_ip: str, tcp_port: int = 5858, on_device_found=None, on_device_lost=None, is_sharing_fn=None):
        self.device_name = device_name
        self.local_ip = local_ip
        self.tcp_port = tcp_port
        self.on_device_found = on_device_found
        self.on_device_lost = on_device_lost
        self.is_sharing_fn = is_sharing_fn
        
        self.running = False
        self.is_scanning = False
        self.discovered_devices = {}  # "ip" -> dict
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
        """Periodically broadcast UDP beacon to advertise presence on local network when sharing."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(1.0)

        while self.running:
            # Only broadcast if actively sharing screen
            is_sharing = True if not self.is_sharing_fn else bool(self.is_sharing_fn())
            if not is_sharing:
                time.sleep(1.0)
                continue

            payload = json.dumps({
                "service": "lancast",
                "name": self.device_name,
                "ip": self.local_ip,
                "port": self.tcp_port,
                "sharing": True
            }).encode('utf-8')

            try:
                # 1. Limited broadcast
                sock.sendto(payload, ('255.255.255.255', UDP_DISCOVERY_PORT))

                # 2. Directed subnet broadcast (e.g. 192.168.8.255)
                if self.local_ip and '.' in self.local_ip:
                    prefix = self.local_ip.rsplit('.', 1)[0]
                    try:
                        sock.sendto(payload, (f"{prefix}.255", UDP_DISCOVERY_PORT))
                    except Exception:
                        pass

                # 3. Unicast directly to known ARP neighbors (guaranteed to bypass Wi-Fi broadcast drops)
                try:
                    with open("/proc/net/arp", "r") as f:
                        for line in f.readlines()[1:]:
                            parts = line.split()
                            if len(parts) >= 4 and parts[2] != "0x0" and parts[3] != "00:00:00:00:00:00":
                                a_ip = parts[0]
                                if a_ip != self.local_ip and not a_ip.endswith(".1"):
                                    try:
                                        sock.sendto(payload, (a_ip, UDP_DISCOVERY_PORT))
                                    except Exception:
                                        pass
                except Exception:
                    pass
            except Exception:
                pass
            time.sleep(2.5)

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
                    peer_sharing = msg.get("sharing", False)
                    
                    if peer_ip == self.local_ip or peer_ip.startswith("127."):
                        continue
                    
                    if peer_sharing:
                        self._register_device(
                            ip=peer_ip,
                            name=msg.get("name", f"Device-{peer_ip}"),
                            port=peer_port
                        )
                    else:
                        self._remove_device(peer_ip)
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

                    # Include active ARP neighbors first
                    try:
                        with open("/proc/net/arp", "r") as f:
                            for line in f.readlines()[1:]:
                                parts = line.split()
                                if len(parts) >= 4 and parts[2] != "0x0" and parts[3] != "00:00:00:00:00:00":
                                    a_ip = parts[0]
                                    if a_ip != self.local_ip and not a_ip.endswith(".1"):
                                        for p in target_ports:
                                            targets.append((a_ip, p))
                    except Exception:
                        pass

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
            s.settimeout(1.0)  # 1.0s timeout for reliable Wi-Fi responses
            try:
                s.connect((ip, port))
            except Exception:
                s.close()
                return

            name = None
            is_sharing = False

            # Send HTTP GET /info for instant host identity and status
            try:
                req = f"GET /info HTTP/1.1\r\nHost: {ip}:{port}\r\nConnection: close\r\n\r\n"
                s.sendall(req.encode('utf-8'))
                s.settimeout(0.8)
                resp = s.recv(1024).decode('utf-8', errors='ignore')
                if "{" in resp:
                    body = resp[resp.find("{"):resp.rfind("}") + 1]
                    info = json.loads(body)
                    if "name" in info:
                        name = info["name"]
                    if "sharing" in info:
                        is_sharing = bool(info["sharing"])
            except Exception:
                pass

            s.close()
            if is_sharing:
                if not name:
                    name = f"DogRemote Host ({ip})"
                self._register_device(ip=ip, name=name, port=port)
            else:
                self._remove_device(ip)
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
        is_new = False
        with self._lock:
            if dev_id in self.discovered_devices:
                self.discovered_devices[dev_id]["last_seen"] = time.time()
                # Update name if a better descriptive name was found
                old_name = self.discovered_devices[dev_id].get("name", "")
                if name and (name != old_name and not name.startswith("Host-")):
                    self.discovered_devices[dev_id]["name"] = name
                    dev["name"] = name
            else:
                self.discovered_devices[dev_id] = dev
                is_new = True

        if self.on_device_found:
            self.on_device_found(dev, is_new)

    def _clean_loop(self):
        """Prunes dead devices after 5 seconds of silence."""
        while self.running:
            time.sleep(2.0)
            now = time.time()
            expired = []
            with self._lock:
                for k, v in list(self.discovered_devices.items()):
                    if now - v["last_seen"] > 5.0:
                        expired.append(k)
                        del self.discovered_devices[k]
            for k in expired:
                if self.on_device_lost:
                    self.on_device_lost(k)

    def _remove_device(self, ip: str):
        dev_id = ip
        removed = False
        with self._lock:
            if dev_id in self.discovered_devices:
                del self.discovered_devices[dev_id]
                removed = True
        if removed and self.on_device_lost:
            self.on_device_lost(dev_id)

    def get_devices(self):
        with self._lock:
            return list(self.discovered_devices.values())
