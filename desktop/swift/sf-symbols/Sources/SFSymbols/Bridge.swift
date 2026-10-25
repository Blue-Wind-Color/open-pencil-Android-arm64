import Foundation

/// The C functions the desktop app calls. Requests and answers are JSON in C strings, and every
/// answer is freed with `op_sf_symbols_free`.

private func json<T: Encodable>(_ value: T?) -> String? {
  guard let value, let data = try? JSONEncoder().encode(value) else { return nil }
  return String(decoding: data, as: UTF8.self)
}

private func answer(_ text: String?) -> UnsafeMutablePointer<CChar>? {
  text.flatMap { strdup($0) }
}

/// The symbols this Mac draws, or null when it cannot draw them as outlines.
@_cdecl("op_sf_symbols_catalogue")
public func opSFSymbolsCatalogue() -> UnsafeMutablePointer<CChar>? {
  guard #available(macOS 14, *) else { return nil }
  return answer(json(catalogue()))
}

/// Each named symbol this Mac has, drawn as the request asks. Must run on the main thread.
@_cdecl("op_sf_symbols_render")
public func opSFSymbolsRender(_ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
  guard #available(macOS 14, *),
    let request = try? JSONDecoder().decode(
      RenderRequest.self, from: Data(String(cString: request).utf8))
  else { return nil }
  let icons = MainActor.assumeIsolated {
    var icons: [String: Icon] = [:]
    for name in request.names {
      if let icon = icon(name, request) { icons[name] = icon }
    }
    return json(icons)
  }
  return answer(icons)
}

@_cdecl("op_sf_symbols_free")
public func opSFSymbolsFree(_ answer: UnsafeMutablePointer<CChar>?) {
  free(answer)
}
