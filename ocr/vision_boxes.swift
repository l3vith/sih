import AppKit
import Foundation
import ImageIO
import Vision

struct Box: Codable {
    let text: String
    let bbox: Coordinates
    let confidence: Float
}

struct Coordinates: Codable {
    let x0: Double
    let y0: Double
    let x1: Double
    let y1: Double
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("Usage: vision-ocr <image>\n".utf8))
    exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard
    let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
    FileHandle.standardError.write(Data("Unable to decode image\n".utf8))
    exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.minimumTextHeight = 0.005

do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let width = Double(image.width)
    let height = Double(image.height)
    let boxes = (request.results ?? []).compactMap { observation -> Box? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let rect = observation.boundingBox
        return Box(
            text: candidate.string,
            bbox: Coordinates(
                x0: rect.minX * width,
                y0: (1.0 - rect.maxY) * height,
                x1: rect.maxX * width,
                y1: (1.0 - rect.minY) * height
            ),
            confidence: candidate.confidence
        )
    }
    let encoder = JSONEncoder()
    FileHandle.standardOutput.write(try encoder.encode(boxes))
} catch {
    FileHandle.standardError.write(Data("Vision OCR failed: \(error)\n".utf8))
    exit(4)
}
