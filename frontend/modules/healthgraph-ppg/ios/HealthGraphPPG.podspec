Pod::Spec.new do |s|
  s.name           = 'HealthGraphPPG'
  s.version        = '1.0.0'
  s.summary        = 'On-device fingertip camera-PPG for HealthGraph'
  s.description    = 'Derived HR/HRV/quality only. No frames or video leave the device.'
  s.author         = 'HealthGraph'
  s.homepage       = 'https://healthgraph.local/ppg'
  s.source         = { :path => '.' }
  s.source_files   = '**/*.swift'
  s.platforms      = { :ios => '15.1' }
  s.dependency 'ExpoModulesCore'
end
