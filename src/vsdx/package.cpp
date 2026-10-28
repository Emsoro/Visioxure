// package.cpp —— 基于 miniz 的 OPC 包读写
#include "package.hpp"

#include "xml.hpp"

#include <algorithm>
#include <cstring>

#include "miniz.h"

namespace vsx {

namespace {

std::string NormalizePartName(std::string name) {
    // 去掉前导 /，统一小写比较不必要（OPC 大小写敏感）
    while (!name.empty() && (name.front() == '/' || name.front() == '\\')) name.erase(name.begin());
    std::replace(name.begin(), name.end(), '\\', '/');
    return name;
}

// 规范化 "a/b/../c" 形式
std::string NormalizePath(const std::string& path) {
    std::vector<std::string> out;
    size_t start = 0;
    while (start <= path.size()) {
        size_t slash = path.find('/', start);
        std::string seg = path.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
        if (seg == "..") {
            if (!out.empty()) out.pop_back();
        } else if (!seg.empty() && seg != ".") {
            out.push_back(seg);
        }
        if (slash == std::string::npos) break;
        start = slash + 1;
    }
    std::string res;
    for (size_t i = 0; i < out.size(); ++i) {
        if (i) res += '/';
        res += out[i];
    }
    return res;
}

}  // namespace

bool Package::LoadFromBytes(const std::string& bytes, Package& out, std::string& err) {
    if (bytes.empty()) {
        err = "空文件";
        return false;
    }
    mz_zip_archive zip;
    std::memset(&zip, 0, sizeof(zip));
    if (!mz_zip_reader_init_mem(&zip, bytes.data(), bytes.size(), 0)) {
        err = "不是合法的 zip/OPC 包";
        return false;
    }
    mz_uint count = mz_zip_reader_get_num_files(&zip);
    for (mz_uint i = 0; i < count; ++i) {
        mz_zip_archive_file_stat st;
        if (!mz_zip_reader_file_stat(&zip, i, &st)) continue;
        if (st.m_is_directory || st.m_is_encrypted) continue;
        size_t size = 0;
        void* data = mz_zip_reader_extract_to_heap(&zip, i, &size, 0);
        if (!data) continue;
        std::string name = NormalizePartName(st.m_filename);
        out.parts_[name] = std::string(static_cast<const char*>(data), size);
        mz_free(data);
    }
    mz_zip_reader_end(&zip);
    if (out.parts_.empty()) {
        err = "OPC 包内没有 part";
        return false;
    }
    return true;
}

std::string Package::ToBytes() const {
    mz_zip_archive zip;
    std::memset(&zip, 0, sizeof(zip));
    if (!mz_zip_writer_init_heap(&zip, 0, 0)) return {};
    for (const auto& [name, data] : parts_) {
        if (!mz_zip_writer_add_mem(&zip, name.c_str(), data.data(), data.size(),
                                   MZ_DEFAULT_COMPRESSION)) {
            mz_zip_writer_end(&zip);
            return {};
        }
    }
    void* buf = nullptr;
    size_t size = 0;
    std::string out;
    if (mz_zip_writer_finalize_heap_archive(&zip, &buf, &size)) {
        out.assign(static_cast<const char*>(buf), size);
    }
    if (buf) mz_free(buf);
    mz_zip_writer_end(&zip);
    return out;
}

void Package::Add(const std::string& name, std::string data) {
    parts_[NormalizePartName(name)] = std::move(data);
}

bool Package::Has(const std::string& name) const {
    return parts_.count(NormalizePartName(name)) != 0;
}

const std::string* Package::Find(const std::string& name) const {
    auto it = parts_.find(NormalizePartName(name));
    return it == parts_.end() ? nullptr : &it->second;
}

std::string Package::FindOr(const std::string& name, const std::string& def) const {
    const std::string* p = Find(name);
    return p ? *p : def;
}

std::string Package::RelsPathFor(const std::string& partName) {
    if (partName.empty()) return "_rels/.rels";
    size_t slash = partName.find_last_of('/');
    std::string dir = slash == std::string::npos ? "" : partName.substr(0, slash + 1);
    std::string file = slash == std::string::npos ? partName : partName.substr(slash + 1);
    return dir + "_rels/" + file + ".rels";
}

std::string Package::ResolveTarget(const std::string& basePart, const std::string& target) {
    if (target.empty()) return {};
    if (target[0] == '/') return NormalizePath(NormalizePartName(target));
    size_t slash = basePart.find_last_of('/');
    std::string dir = slash == std::string::npos ? "" : basePart.substr(0, slash + 1);
    return NormalizePath(dir + target);
}

std::vector<Package::Rel> Package::Rels(const std::string& partName) const {
    std::vector<Rel> out;
    std::string xml = FindOr(RelsPathFor(partName));
    if (xml.empty()) return out;
    XmlNode root;
    std::string err;
    if (!ParseXml(xml, root, err)) return out;
    for (const XmlNode* r : root.childrenNamed("Relationship")) {
        Rel rel;
        rel.id = r->attr("Id");
        rel.type = r->attr("Type");
        rel.target = ResolveTarget(partName, r->attr("Target"));
        out.push_back(std::move(rel));
    }
    return out;
}

}  // namespace vsx
