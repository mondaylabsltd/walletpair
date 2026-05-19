Pod::Spec.new do |s|
  s.name           = 'BlePeripheral'
  s.version        = '0.1.0'
  s.summary        = 'WalletPair BLE Peripheral module'
  s.homepage       = 'https://github.com/example'
  s.license        = 'MIT'
  s.author         = 'WalletPair'
  s.source         = { git: '' }
  s.platforms      = { ios: '15.1' }
  s.swift_version  = '5.9'
  s.source_files   = '*.swift'
  s.dependency 'ExpoModulesCore'
end
