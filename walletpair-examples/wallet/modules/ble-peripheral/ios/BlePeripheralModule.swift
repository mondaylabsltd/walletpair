import ExpoModulesCore
import CoreBluetooth

public class BlePeripheralModule: Module {
  private var delegate: PeripheralDelegate?

  public func definition() -> ModuleDefinition {
    Name("BlePeripheral")

    Events("onWrite", "onSubscribe", "onUnsubscribe", "onConnect", "onDisconnect")

    AsyncFunction("start") { (svcUuid: String, writeUuid: String, notifyUuid: String, name: String, promise: Promise) in
      self.delegate?.stop()
      let d = PeripheralDelegate(module: self, svcUuid: svcUuid, writeUuid: writeUuid, notifyUuid: notifyUuid, name: name)
      self.delegate = d
      d.start(promise: promise)
    }

    AsyncFunction("stop") {
      self.delegate?.stop()
      self.delegate = nil
    }

    AsyncFunction("sendNotification") { (base64Data: String) in
      self.delegate?.sendNotification(base64Data: base64Data)
    }
  }

  func emit(_ name: String, _ body: [String: Any]) {
    sendEvent(name, body)
  }
}

private class PeripheralDelegate: NSObject, CBPeripheralManagerDelegate {
  private weak var module: BlePeripheralModule?
  private var manager: CBPeripheralManager?
  private var notifyChar: CBMutableCharacteristic?
  private var subscribedCentral: CBCentral?
  private var pendingPromise: Promise?
  private var sendQueue: [Data] = []    // queued notification frames
  private var sending = false

  private let svcUuid: CBUUID
  private let writeUuid: CBUUID
  private let notifyUuid: CBUUID
  private let deviceName: String

  init(module: BlePeripheralModule, svcUuid: String, writeUuid: String, notifyUuid: String, name: String) {
    self.module = module
    self.svcUuid = CBUUID(string: svcUuid)
    self.writeUuid = CBUUID(string: writeUuid)
    self.notifyUuid = CBUUID(string: notifyUuid)
    self.deviceName = name
    super.init()
  }

  func start(promise: Promise) {
    self.pendingPromise = promise
    self.manager = CBPeripheralManager(delegate: self, queue: nil)
    NSLog("[BLE] CBPeripheralManager created, waiting for poweredOn...")
  }

  func stop() {
    if let m = manager {
      if m.isAdvertising { m.stopAdvertising() }
      m.removeAllServices()
    }
    manager?.delegate = nil
    manager = nil
    subscribedCentral = nil
    pendingPromise = nil
    NSLog("[BLE] stopped")
  }

  func sendNotification(base64Data: String) {
    guard let data = Data(base64Encoded: base64Data) else {
      NSLog("[BLE] sendNotification: invalid base64")
      return
    }
    sendQueue.append(data)
    drainQueue()
  }

  /// Send queued frames one at a time. If updateValue returns false (queue full),
  /// stop and wait for peripheralManagerIsReady(toUpdateSubscribers:) callback.
  private func drainQueue() {
    guard let m = manager, let ch = notifyChar, let central = subscribedCentral else { return }
    while !sendQueue.isEmpty {
      let data = sendQueue.first!
      let ok = m.updateValue(data, for: ch, onSubscribedCentrals: [central])
      if ok {
        sendQueue.removeFirst()
        NSLog("[BLE] sent \(data.count) bytes, \(sendQueue.count) queued")
      } else {
        // Transmit queue full — will resume in peripheralManagerIsReady
        NSLog("[BLE] queue full, \(sendQueue.count) frames pending")
        return
      }
    }
  }

  // MARK: - CBPeripheralManagerDelegate

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    NSLog("[BLE] state changed: \(peripheral.state.rawValue)")
    guard peripheral.state == .poweredOn else {
      let msg: String
      switch peripheral.state {
      case .unauthorized: msg = "unauthorized"
      case .unsupported: msg = "unsupported"
      case .poweredOff: msg = "powered off"
      default: msg = "unavailable (\(peripheral.state.rawValue))"
      }
      pendingPromise?.reject("BLE_ERROR", "Bluetooth is \(msg)")
      pendingPromise = nil
      return
    }

    let writeCh = CBMutableCharacteristic(
      type: writeUuid, properties: [.write, .writeWithoutResponse], value: nil, permissions: [.writeable])
    let notifyCh = CBMutableCharacteristic(
      type: notifyUuid, properties: [.notify, .read], value: nil, permissions: [.readable])
    self.notifyChar = notifyCh

    let svc = CBMutableService(type: svcUuid, primary: true)
    svc.characteristics = [writeCh, notifyCh]

    NSLog("[BLE] adding service \(svcUuid)")
    peripheral.add(svc)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    if let error = error {
      NSLog("[BLE] didAdd service error: \(error)")
      pendingPromise?.reject("BLE_ERROR", error.localizedDescription)
      pendingPromise = nil
      return
    }
    NSLog("[BLE] service added, starting advertising as '\(deviceName)'")
    peripheral.startAdvertising([
      CBAdvertisementDataLocalNameKey: deviceName,
      CBAdvertisementDataServiceUUIDsKey: [svcUuid]
    ])
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    if let error = error {
      NSLog("[BLE] advertising failed: \(error)")
      pendingPromise?.reject("BLE_ERROR", error.localizedDescription)
    } else {
      NSLog("[BLE] advertising started")
      pendingPromise?.resolve(nil)
    }
    pendingPromise = nil
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    NSLog("[BLE] central subscribed to \(characteristic.uuid)")
    if characteristic.uuid == notifyUuid {
      subscribedCentral = central
      module?.emit("onSubscribe", ["characteristicUuid": characteristic.uuid.uuidString.lowercased()])
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    NSLog("[BLE] central unsubscribed from \(characteristic.uuid)")
    if characteristic.uuid == notifyUuid {
      subscribedCentral = nil
      module?.emit("onUnsubscribe", ["characteristicUuid": characteristic.uuid.uuidString.lowercased()])
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    NSLog("[BLE] received \(requests.count) write request(s)")
    for request in requests {
      peripheral.respond(to: request, withResult: .success)
      if let value = request.value {
        NSLog("[BLE] write on \(request.characteristic.uuid): \(value.count) bytes")
        module?.emit("onWrite", [
          "characteristicUuid": request.characteristic.uuid.uuidString.lowercased(),
          "value": value.base64EncodedString()
        ])
      }
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    NSLog("[BLE] read request on \(request.characteristic.uuid)")
    request.value = notifyChar?.value ?? Data()
    peripheral.respond(to: request, withResult: .success)
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    NSLog("[BLE] transmit queue ready, resuming \(sendQueue.count) pending frames")
    drainQueue()
  }
}
