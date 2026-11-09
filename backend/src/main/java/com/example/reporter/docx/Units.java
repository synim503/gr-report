package com.example.reporter.docx;

final class Units {
    private Units() {}
    static int twips(double pt) { return (int) Math.round(pt * 20); }
    static long emu(double pt) { return Math.round(pt * 12700); }
}
