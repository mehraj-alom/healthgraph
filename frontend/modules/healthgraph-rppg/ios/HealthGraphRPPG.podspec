Pod::Spec.new do |s|
  s.name           = 'HealthGraphRPPG'
  s.version        = '1.0.0'
  s.summary        = 'On-device face rPPG capture for HealthGraph'
  s.description    = 'Front-camera ROI window capture only. No frames or video leave the device.'
  s.author         = 'HealthGraph'
  s.homepage       = 'https://healthgraph.local/rppg'
  s.source         = { :path => '.' }
  s.source_files   = '**/*.swift'
  s.platforms      = { :ios => '15.1' }
  s.dependency 'ExpoModulesCore'
end
