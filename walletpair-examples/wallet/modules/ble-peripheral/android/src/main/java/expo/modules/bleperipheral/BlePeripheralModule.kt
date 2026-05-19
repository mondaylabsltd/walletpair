package expo.modules.bleperipheral

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class BlePeripheralModule : Module() {

  private var gattServer: BluetoothGattServer? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var currentAdvCallback: AdvertiseCallback? = null
  private var connectedDevice: BluetoothDevice? = null
  private var notifyChar: BluetoothGattCharacteristic? = null

  private val CCC_DESCRIPTOR_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  private val TAG = "BlePeripheral"

  override fun definition() = ModuleDefinition {
    Name("BlePeripheral")

    Events("onWrite", "onSubscribe", "onUnsubscribe", "onConnect", "onDisconnect")

    AsyncFunction("start") { svcUuid: String, writeUuid: String, notifyUuid: String, name: String ->
      val ctx = appContext.reactContext ?: throw Exception("No context")
      val manager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
      val adapter = manager.adapter ?: throw Exception("Bluetooth not available")

      // Always stop previous instance first
      stopInternal(adapter)

      // Build GATT service
      val service = BluetoothGattService(
        UUID.fromString(svcUuid),
        BluetoothGattService.SERVICE_TYPE_PRIMARY
      )

      val writeCh = BluetoothGattCharacteristic(
        UUID.fromString(writeUuid),
        BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
        BluetoothGattCharacteristic.PERMISSION_WRITE
      )
      service.addCharacteristic(writeCh)

      val notifyCh = BluetoothGattCharacteristic(
        UUID.fromString(notifyUuid),
        BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
        BluetoothGattCharacteristic.PERMISSION_READ
      )
      val cccDesc = BluetoothGattDescriptor(
        CCC_DESCRIPTOR_UUID,
        BluetoothGattDescriptor.PERMISSION_WRITE or BluetoothGattDescriptor.PERMISSION_READ
      )
      notifyCh.addDescriptor(cccDesc)
      service.addCharacteristic(notifyCh)
      notifyChar = notifyCh

      // Open GATT server
      gattServer = manager.openGattServer(ctx, gattCallback)
      gattServer?.addService(service)

      // Set adapter name
      adapter.name = name

      // Start advertising and WAIT for the result
      val adv = adapter.bluetoothLeAdvertiser
        ?: throw Exception("BLE advertising not supported")
      advertiser = adv

      val settings = AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setConnectable(true)
        .setTimeout(0)
        .build()

      val data = AdvertiseData.Builder()
        .setIncludeDeviceName(true)
        .build()

      // Use CountDownLatch to block until async callback fires
      val latch = CountDownLatch(1)
      var advError: String? = null

      val callback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
          android.util.Log.i(TAG, "Advertising started")
          latch.countDown()
        }
        override fun onStartFailure(errorCode: Int) {
          advError = "Advertising failed: code $errorCode (1=DATA_TOO_LARGE, 2=TOO_MANY, 3=ALREADY_STARTED)"
          android.util.Log.e(TAG, advError!!)
          latch.countDown()
        }
      }
      currentAdvCallback = callback

      adv.startAdvertising(settings, data, callback)

      // Wait up to 5 seconds for callback
      if (!latch.await(5, TimeUnit.SECONDS)) {
        throw Exception("Advertising start timed out")
      }
      if (advError != null) {
        // Cleanup on failure
        stopInternal(adapter)
        throw Exception(advError!!)
      }
      // Advertising is confirmed running
    }

    AsyncFunction("stop") {
      val ctx = appContext.reactContext
      if (ctx != null) {
        val manager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = manager.adapter
        if (adapter != null) {
          stopInternal(adapter)
        }
      }
    }

    AsyncFunction("sendNotification") { base64Data: String ->
      val device = connectedDevice ?: return@AsyncFunction
      val ch = notifyChar ?: return@AsyncFunction
      val server = gattServer ?: return@AsyncFunction
      val bytes = Base64.decode(base64Data, Base64.NO_WRAP)
      ch.value = bytes
      server.notifyCharacteristicChanged(device, ch, false)
    }
  }

  private fun stopInternal(adapter: BluetoothAdapter) {
    // Stop advertising with the EXACT callback that started it
    val cb = currentAdvCallback
    if (cb != null) {
      try {
        adapter.bluetoothLeAdvertiser?.stopAdvertising(cb)
        android.util.Log.i(TAG, "Stopped advertising")
      } catch (e: Exception) {
        android.util.Log.w(TAG, "stopAdvertising error: ${e.message}")
      }
      currentAdvCallback = null
    }
    try { gattServer?.close() } catch (_: Exception) {}
    gattServer = null
    advertiser = null
    connectedDevice = null
    notifyChar = null
    // Small delay for Android BLE stack cleanup
    Thread.sleep(300)
  }

  // --- GATT Server Callback ---

  private val gattCallback = object : BluetoothGattServerCallback() {

    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      android.util.Log.i(TAG, "Connection state: $newState device: ${device.address}")
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        connectedDevice = device
        sendEvent("onConnect", mapOf("address" to device.address))
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        if (connectedDevice?.address == device.address) {
          connectedDevice = null
          sendEvent("onDisconnect", mapOf("address" to device.address))
        }
      }
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice, requestId: Int,
      characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean, responseNeeded: Boolean,
      offset: Int, value: ByteArray
    ) {
      if (responseNeeded) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
      }
      val b64 = Base64.encodeToString(value, Base64.NO_WRAP)
      android.util.Log.i(TAG, "Write received on ${characteristic.uuid}, ${value.size} bytes")
      sendEvent("onWrite", mapOf(
        "characteristicUuid" to characteristic.uuid.toString(),
        "value" to b64
      ))
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice, requestId: Int,
      descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean, responseNeeded: Boolean,
      offset: Int, value: ByteArray
    ) {
      if (responseNeeded) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
      }
      if (descriptor.uuid == CCC_DESCRIPTOR_UUID) {
        val charUuid = descriptor.characteristic.uuid.toString()
        if (value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
          android.util.Log.i(TAG, "Subscribe on $charUuid")
          sendEvent("onSubscribe", mapOf("characteristicUuid" to charUuid))
        } else if (value.contentEquals(BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE)) {
          android.util.Log.i(TAG, "Unsubscribe on $charUuid")
          sendEvent("onUnsubscribe", mapOf("characteristicUuid" to charUuid))
        }
      }
    }

    override fun onCharacteristicReadRequest(
      device: BluetoothDevice, requestId: Int,
      offset: Int, characteristic: BluetoothGattCharacteristic
    ) {
      gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset,
        characteristic.value ?: ByteArray(0))
    }
  }
}
